import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { en16931Problems, xrechnungProblems } from "../src/profile-check.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * BT-6 / BT-111 - the VAT total in the currency VAT is accounted in.
 *
 * This one was built ahead of the other edge cases for a reason that has nothing to do with how
 * often it occurs: a foreign-currency invoice went out WITHOUT a Euro tax figure and without a word
 * of warning. Same shape as Skonto entered as an allowance - the library accepted an input that
 * produced a deficient document and said nothing. Most of what is tested here is the warning.
 */

const usd: Invoice = {
  number: "RE-2026-700",
  issueDate: "2026-09-09",
  currency: "USD",
  buyerReference: "LEITWEG-1",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "re@muster.invalid",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "A", phone: "1", email: "a@muster.invalid" },
  },
  buyer: {
    name: "Buyer Inc",
    electronicAddress: "ap@buyer.invalid",
    address: { city: "Boston", postCode: "02108", country: "US" },
  },
  delivery: { date: "2026-09-01" },
  dueDate: "2026-10-09",
  lines: [
    {
      name: "Consulting",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 1000,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
  payment: { meansCode: "58", iban: "DE02120300000000202051" },
};

const withEuroVat: Invoice = { ...usd, taxCurrency: "EUR", taxTotalInTaxCurrency: 172.4 };

describe("the silence that made this urgent", () => {
  it("warns when a non-EUR invoice states no accounting currency", () => {
    const problems = xrechnungProblems(usd);
    expect(problems.join(" ")).toContain("USD");
    expect(problems.join(" ")).toContain("BT-6");
  });

  it("stops warning once the Euro figure is there", () => {
    expect(xrechnungProblems(withEuroVat).join(" ")).not.toContain("BT-6");
  });

  it("says nothing at all for a plain Euro invoice", () => {
    const eur: Invoice = { ...usd, currency: "EUR" };
    expect(xrechnungProblems(eur).join(" ")).not.toContain("BT-6");
  });
});

describe("BR-53: a currency without its amount, and the reverse", () => {
  it("refuses a currency with no figure in it", () => {
    const problems = en16931Problems({ ...usd, taxCurrency: "EUR" });
    expect(problems.join(" ")).toContain("BT-111");
  });

  it("refuses a figure with no currency", () => {
    const problems = en16931Problems({ ...usd, taxTotalInTaxCurrency: 172.4 });
    expect(problems.join(" ")).toContain("BT-6");
  });

  it("accepts the pair", () => {
    expect(en16931Problems(withEuroVat)).toEqual([]);
  });
});

describe("the same element twice, told apart by its currency", () => {
  const computed = computeInvoice(withEuroVat);

  it("CII writes two TaxTotalAmounts - which is why the schema caps it at two", () => {
    const xml = toCII(withEuroVat, computed);
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="USD">190.00</ram:TaxTotalAmount>'); // BT-110
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">172.40</ram:TaxTotalAmount>'); // BT-111
    expect(xml.match(/<ram:TaxTotalAmount/g)).toHaveLength(2);
  });

  it("CII writes the tax currency BEFORE the invoice currency", () => {
    const xml = toCII(withEuroVat, computed);
    expect(xml).toContain("<ram:TaxCurrencyCode>EUR</ram:TaxCurrencyCode>");
    expect(xml.indexOf("TaxCurrencyCode")).toBeLessThan(xml.indexOf("InvoiceCurrencyCode"));
  });

  it("UBL adds a SECOND TaxTotal that carries no breakdown", () => {
    const xml = toUBL(withEuroVat, computed);
    expect(xml).toContain("<cbc:TaxCurrencyCode>EUR</cbc:TaxCurrencyCode>");
    expect(xml).toContain(
      '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">172.40</cbc:TaxAmount></cac:TaxTotal>',
    );
    expect(xml.match(/<cac:TaxTotal>/g)).toHaveLength(2);
  });

  it("adds neither when the fields are absent", () => {
    const c = computeInvoice(usd);
    expect(toCII(usd, c).match(/<ram:TaxTotalAmount/g)).toHaveLength(1);
    expect(toCII(usd, c)).not.toContain("TaxCurrencyCode");
    expect(toUBL(usd, c).match(/<cac:TaxTotal>/g)).toHaveLength(1);
  });
});

describe("we never invent the exchange rate", () => {
  it("takes the amount as given and does not derive it", () => {
    // 190.00 USD of VAT at some rate is 172.40 EUR here. Which rate applies - supply date, invoice
    // date, monthly average - is a tax question, so the number comes from the user, not from us.
    const odd: Invoice = { ...usd, taxCurrency: "EUR", taxTotalInTaxCurrency: 1 };
    expect(toCII(odd, computeInvoice(odd))).toContain(
      '<ram:TaxTotalAmount currencyID="EUR">1.00</ram:TaxTotalAmount>',
    );
  });
});

describe("the paper carries it, because that is who the figure is for", () => {
  it("prints the VAT total in the accounting currency", () => {
    const text = printedText(
      defaultInvoiceTemplate(
        withEuroVat,
        computeInvoice(withEuroVat),
        resolveLabels("de"),
        makeFormatters("de", "USD"),
      ),
    ).join("\n");
    expect(text).toContain("USt in EUR");
    // Formatted as MONEY in the other currency: "172,4" would read as a typo on a tax figure.
    expect(text).toContain("172,40\u00a0€");
  });
});

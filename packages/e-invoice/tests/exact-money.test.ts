import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { paymentTermsText } from "../src/skonto.ts";
import { cents } from "../src/money.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";
import { hardInvoice, hardTotals } from "./support/hard-numbers.ts";

/**
 * Money is decimal, a double is not: 4.515 is stored as 4.51499999..., so float rounding lands one
 * cent short exactly where EN 16931 rounds half away from zero. These assert on what is WRITTEN -
 * both syntaxes and the paper - against figures worked out with integers, never with the code under
 * test. A cent here is a cent the buyer's validator or auditor sees.
 */

const cii = (inv: Invoice) => toCII(inv, computeInvoice(inv));
const ubl = (inv: Invoice) => toUBL(inv, computeInvoice(inv));
const paper = (inv: Invoice) =>
  printedText(
    defaultInvoiceTemplate(
      inv,
      computeInvoice(inv),
      resolveLabels("en"),
      makeFormatters("en", "EUR"),
    ),
  ).join("\n");

const ciiAmount = (tag: string, v: string) => `<ram:${tag}>${v}</ram:${tag}>`;
const ublAmount = (tag: string, v: string) => `<cbc:${tag} currencyID="EUR">${v}</cbc:${tag}>`;

const base: Invoice = {
  number: "RE-1",
  issueDate: "2026-10-15",
  currency: "EUR",
  seller: { name: "S", vatId: "DE123456789", address: { country: "DE" } },
  buyer: { name: "B", address: { country: "DE" } },
  lines: [],
};
const line = (quantity: number, netUnitPrice: number, ratePercent = 19) => ({
  name: "L",
  quantity,
  unit: "C62",
  netUnitPrice,
  vat: { category: "S" as const, ratePercent },
});
const one = (quantity: number, price: number, rate = 19): Invoice => ({
  ...base,
  lines: [line(quantity, price, rate)],
});

describe("a half cent rounds away from zero, in both syntaxes", () => {
  it.each([
    ["3 x 1.505 is 4.52", one(3, 1.505), "LineTotalAmount", "LineExtensionAmount", "4.52"],
    [
      "-3 x 1.505 is -4.52, not -4.51",
      one(-3, 1.505),
      "LineTotalAmount",
      "LineExtensionAmount",
      "-4.52",
    ],
    ["42.50 at 19 % is 8.08 VAT", one(1, 42.5), "CalculatedAmount", "TaxAmount", "8.08"],
    ["30.50 at 7 % is 2.14 VAT", one(1, 30.5, 7), "CalculatedAmount", "TaxAmount", "2.14"],
    ["53.50 at 19 % is 10.17 VAT", one(1, 53.5), "CalculatedAmount", "TaxAmount", "10.17"],
  ])("%s", (_what, inv, ciiTag, ublTag, value) => {
    expect(cii(inv)).toContain(ciiAmount(ciiTag, value));
    expect(ubl(inv)).toContain(ublAmount(ublTag, value));
  });

  it("a percentage allowance: 1 % of 14.50 is 0.15", () => {
    const inv: Invoice = {
      ...one(1, 100),
      allowancesCharges: [
        { isCharge: false, baseAmount: 14.5, percent: 1, vat: { category: "S", ratePercent: 19 } },
      ],
    };
    expect(cii(inv)).toContain(ciiAmount("ActualAmount", "0.15"));
    expect(ubl(inv)).toContain(ublAmount("Amount", "0.15"));
  });

  it("a Skonto base keeps its half cent in the machine-readable line", () => {
    expect(
      paymentTermsText(
        undefined,
        [{ days: 14, percent: 2, baseAmount: 8.165 }],
        "2026-10-15",
        cents(0),
      ),
    ).toContain("BASISBETRAG=8.17#");
  });

  it("a stated tax total in another currency is written to the cent, not truncated", () => {
    const inv: Invoice = { ...one(1, 100), taxCurrency: "CHF", taxTotalInTaxCurrency: 4.515 };
    expect(cii(inv)).toContain('<ram:TaxTotalAmount currencyID="CHF">4.52</ram:TaxTotalAmount>');
    expect(ubl(inv)).toContain('<cbc:TaxAmount currencyID="CHF">4.52</cbc:TaxAmount>');
  });
});

describe("a unit price is written as stated, not cut to two decimals", () => {
  // BT-146 has no two-decimal rule. Cutting 1.505 to 1.50 makes the XML contradict its own line
  // total, and a reader that recomputes gets 4.50.
  it.each([
    [1.505, "1.505"],
    [12.199, "12.199"],
    [0.0001, "0.0001"],
  ])("%s", (price, written) => {
    const inv = one(1, price);
    expect(cii(inv)).toContain(ciiAmount("ChargeAmount", written));
    expect(ubl(inv)).toContain(ublAmount("PriceAmount", written));
  });

  it("and the paper shows the same price the XML states", () => {
    expect(paper(one(3, 1.505))).toContain("€1.505");
  });
});

describe("the hard invoice, figure by figure", () => {
  const T = hardTotals;
  const xmlC = cii(hardInvoice);
  const xmlU = ubl(hardInvoice);
  const text = paper(hardInvoice);

  it("every line total", () => {
    for (const v of T.lineNets) {
      expect(xmlC).toContain(ciiAmount("LineTotalAmount", v));
      expect(xmlU).toContain(ublAmount("LineExtensionAmount", v));
    }
  });

  it("the VAT breakdown", () => {
    for (const g of [T.vat19, T.vat7]) {
      expect(xmlC).toContain(ciiAmount("CalculatedAmount", g.tax));
      expect(xmlC).toContain(ciiAmount("BasisAmount", g.taxable));
      expect(xmlU).toContain(ublAmount("TaxableAmount", g.taxable));
      expect(xmlU).toContain(ublAmount("TaxAmount", g.tax));
    }
  });

  it("the totals", () => {
    expect(xmlC).toContain(ciiAmount("TaxBasisTotalAmount", T.taxBasisTotal));
    expect(xmlC).toContain('<ram:TaxTotalAmount currencyID="EUR">10.22</ram:TaxTotalAmount>');
    expect(xmlC).toContain(ciiAmount("GrandTotalAmount", T.grandTotal));
    expect(xmlC).toContain(ciiAmount("DuePayableAmount", T.grandTotal));
    expect(xmlU).toContain(ublAmount("LineExtensionAmount", T.lineTotal));
    expect(xmlU).toContain(ublAmount("TaxExclusiveAmount", T.taxBasisTotal));
    expect(xmlU).toContain(ublAmount("TaxInclusiveAmount", T.grandTotal));
    expect(xmlU).toContain(ublAmount("PayableAmount", T.grandTotal));
  });

  it("the paper says the same as the XML", () => {
    const money = (v: string) => `€${v.replace("-", "")}`;
    for (const v of [
      ...T.lineNets,
      T.vat19.tax,
      T.vat7.tax,
      T.taxBasisTotal,
      T.taxTotal,
      T.grandTotal,
    ]) {
      expect(text).toContain(money(v));
    }
    for (const s of T.skonto) expect(text).toContain(`→ ${money(s.pays)}`);
  });

  it("no figure is one cent short anywhere", () => {
    // What float rounding wrote for this invoice: three totals a cent short, a price cut to 1.50.
    for (const wrong of ["4.51", "-4.51", "7.11", "0.14", "1.50"]) {
      expect(xmlC).not.toContain(`>${wrong}<`);
      expect(xmlU).not.toContain(`>${wrong}<`);
    }
  });
});

describe("every net amount up to 200.00, at 7 % and 19 %", () => {
  // Integer truth: net cents x rate is the tax in 1/100 cent; round half away from zero.
  const exactTax = (net: number, rate: number) => {
    const t = BigInt(net) * BigInt(rate);
    const c = (t + 50n) / 100n;
    return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
  };

  it("writes the VAT the integers say", () => {
    const wrong: string[] = [];
    for (let net = 1; net <= 20_000; net++) {
      for (const rate of [7, 19]) {
        const xml = cii(one(1, net / 100, rate));
        const want = exactTax(net, rate);
        if (!xml.includes(ciiAmount("CalculatedAmount", want))) wrong.push(`${net / 100}@${rate}%`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

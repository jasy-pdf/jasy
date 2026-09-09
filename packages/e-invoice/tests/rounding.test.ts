import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * BT-114, the deliberate cent. It moves the amount DUE, not the invoice total - and the CII schema
 * puts the element before the grand total, which reads as though it moved that instead. Getting the
 * direction wrong makes an invoice whose own arithmetic disagrees, so that is what these pin down.
 */

const base: Invoice = {
  number: "RE-2026-500",
  issueDate: "2026-09-09",
  currency: "EUR",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "München", postCode: "80331", country: "DE" } },
  lines: [
    {
      // 84.35 net -> 100.3765 gross, which rounds to 100.38 and is worth smoothing.
      name: "Leistung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 84.35,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
};

describe("what it moves, and what it leaves alone", () => {
  it("moves the payable and nothing else", () => {
    const plain = computeInvoice(base);
    const rounded = computeInvoice({ ...base, roundingAmount: 0.02 });
    expect(rounded.grandTotal).toBe(plain.grandTotal); // BT-112 untouched
    expect(rounded.taxTotal).toBe(plain.taxTotal); // BT-110 untouched
    expect(rounded.taxBasisTotal).toBe(plain.taxBasisTotal); // BT-109 untouched
    expect(rounded.duePayable).toBe(round(plain.duePayable + 0.02));
  });

  it("rounds DOWN when the figure is negative", () => {
    const c = computeInvoice({ ...base, roundingAmount: -0.03 });
    expect(c.duePayable).toBe(round(c.grandTotal - 0.03));
  });

  it("stacks with an amount already paid", () => {
    const c = computeInvoice({ ...base, paidAmount: 50, roundingAmount: 0.05 });
    expect(c.duePayable).toBe(round(c.grandTotal - 50 + 0.05));
  });

  it("is 0 when nobody asked, and changes nothing", () => {
    const c = computeInvoice(base);
    expect(c.roundingAmount).toBe(0);
    expect(c.duePayable).toBe(c.grandTotal);
  });
});

describe("both syntaxes, each in its own slot", () => {
  const invoice = { ...base, roundingAmount: 0.02 };
  const computed = computeInvoice(invoice);

  it("CII writes it between the tax total and the grand total", () => {
    const xml = toCII(invoice, computed);
    expect(xml).toContain("<ram:RoundingAmount>0.02</ram:RoundingAmount>");
    expect(xml.indexOf("TaxTotalAmount")).toBeLessThan(xml.indexOf("RoundingAmount"));
    expect(xml.indexOf("RoundingAmount")).toBeLessThan(xml.indexOf("GrandTotalAmount"));
  });

  it("UBL writes it between the prepaid amount and the payable", () => {
    const withPaid = { ...invoice, paidAmount: 10 };
    const xml = toUBL(withPaid, computeInvoice(withPaid));
    expect(xml).toContain(
      '<cbc:PayableRoundingAmount currencyID="EUR">0.02</cbc:PayableRoundingAmount>',
    );
    expect(xml.indexOf("PrepaidAmount")).toBeLessThan(xml.indexOf("PayableRoundingAmount"));
    expect(xml.indexOf("PayableRoundingAmount")).toBeLessThan(xml.indexOf("PayableAmount"));
  });

  it("keeps a negative sign, which is the whole point of the field", () => {
    const down = { ...base, roundingAmount: -0.03 };
    const c = computeInvoice(down);
    expect(toCII(down, c)).toContain("<ram:RoundingAmount>-0.03</ram:RoundingAmount>");
    expect(toUBL(down, c)).toContain(">-0.03</cbc:PayableRoundingAmount>");
  });

  it("emits nothing at all when there is no rounding", () => {
    const c = computeInvoice(base);
    expect(toCII(base, c)).not.toContain("RoundingAmount");
    expect(toUBL(base, c)).not.toContain("PayableRoundingAmount");
  });
});

describe("the paper explains the difference", () => {
  const printed = (invoice: Invoice) =>
    printedText(
      defaultInvoiceTemplate(
        invoice,
        computeInvoice(invoice),
        resolveLabels("de"),
        makeFormatters("de", "EUR"),
      ),
    ).join("\n");

  it("shows the rounding with its sign, so the payable is not a mystery", () => {
    const text = printed({ ...base, roundingAmount: 0.02 });
    expect(text).toContain("Rundung");
    expect(text).toMatch(/\+0,02/);
  });

  it("shows a downward rounding as a subtraction", () => {
    expect(printed({ ...base, roundingAmount: -0.03 })).toMatch(/-0,03/);
  });

  it("prints no rounding line when there is none", () => {
    expect(printed(base)).not.toContain("Rundung");
  });
});

const round = (n: number) => Math.round(n * 100) / 100;

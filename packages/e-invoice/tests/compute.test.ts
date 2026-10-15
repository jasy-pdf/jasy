import { describe, it, expect } from "vitest";
import { toDecimalString as text } from "@jasy/decy";
import { computeInvoice } from "../src/compute";
import { Invoice } from "../src/invoice";

const base = {
  number: "RE-1",
  issueDate: "2026-06-17",
  currency: "EUR",
  seller: { name: "S", address: { country: "DE" } },
  buyer: { name: "B", address: { country: "DE" } },
} as const;

describe("computeInvoice", () => {
  it("sums line nets and builds the VAT breakdown for a mixed-rate invoice", () => {
    const inv: Invoice = {
      ...base,
      lines: [
        {
          name: "A",
          quantity: 2,
          unit: "C62",
          netUnitPrice: 100,
          vat: { category: "S", ratePercent: 19 },
        },
        {
          name: "B",
          quantity: 1,
          unit: "C62",
          netUnitPrice: 50,
          vat: { category: "S", ratePercent: 7 },
        },
      ],
    };
    const c = computeInvoice(inv);
    expect(c.lineNets.map(text)).toEqual(["200.00", "50.00"]);
    expect(text(c.lineTotal)).toBe("250.00");
    expect(text(c.taxBasisTotal)).toBe("250.00");
    // two groups: 19% on 200 → 38, 7% on 50 → 3.5
    expect(
      c.vatBreakdown.map((g) => [g.ratePercent, text(g.taxableAmount), text(g.taxAmount)]),
    ).toEqual([
      [19, "200.00", "38.00"],
      [7, "50.00", "3.50"],
    ]);
    expect(text(c.taxTotal)).toBe("41.50");
    expect(text(c.grandTotal)).toBe("291.50");
    expect(text(c.duePayable)).toBe("291.50");
  });

  it("applies the price base quantity and line allowances to the line net", () => {
    const inv: Invoice = {
      ...base,
      lines: [
        // price "9.90 per 100 units", 250 units → 24.75, minus a 0.75 line allowance → 24.00
        {
          name: "A",
          quantity: 250,
          unit: "C62",
          netUnitPrice: 9.9,
          priceBaseQuantity: 100,
          vat: { category: "S", ratePercent: 19 },
          allowancesCharges: [
            { isCharge: false, amount: 0.75, vat: { category: "S", ratePercent: 19 } },
          ],
        },
      ],
    };
    const c = computeInvoice(inv);
    expect(c.lineNets.map(text)).toEqual(["24.00"]);
    expect(text(c.taxTotal)).toBe("4.56"); // 24 x 19 % = 4.56
    expect(text(c.grandTotal)).toBe("28.56");
  });

  it("subtracts a document-level allowance from its VAT group and the totals", () => {
    const inv: Invoice = {
      ...base,
      lines: [
        {
          name: "A",
          quantity: 1,
          unit: "C62",
          netUnitPrice: 100,
          vat: { category: "S", ratePercent: 19 },
        },
      ],
      allowancesCharges: [{ isCharge: false, amount: 10, vat: { category: "S", ratePercent: 19 } }],
    };
    const c = computeInvoice(inv);
    expect(text(c.lineTotal)).toBe("100.00");
    expect(text(c.allowanceTotal)).toBe("10.00");
    expect(text(c.taxBasisTotal)).toBe("90.00");
    expect(text(c.vatBreakdown[0].taxableAmount)).toBe("90.00"); // 100 - 10
    expect(text(c.taxTotal)).toBe("17.10"); // 90 × 19%
    expect(text(c.grandTotal)).toBe("107.10");
  });

  it("handles reverse charge (AE): no tax, exemption reason on the group, due = net", () => {
    const inv: Invoice = {
      ...base,
      lines: [
        { name: "Beratung", quantity: 1, unit: "C62", netUnitPrice: 1000, vat: { category: "AE" } },
      ],
      vatExemptionReasons: { AE: { text: "Reverse charge (§13b UStG)", code: "VATEX-EU-AE" } },
    };
    const c = computeInvoice(inv);
    expect(text(c.taxTotal)).toBe("0.00");
    expect(text(c.grandTotal)).toBe("1000.00");
    const [g] = c.vatBreakdown;
    expect([g.category, g.ratePercent, text(g.taxableAmount), text(g.taxAmount)]).toEqual([
      "AE",
      0,
      "1000.00",
      "0.00",
    ]);
    expect(g.exemption).toEqual({ text: "Reverse charge (§13b UStG)", code: "VATEX-EU-AE" });
  });

  it("subtracts the paid amount to get the amount due", () => {
    const inv: Invoice = {
      ...base,
      lines: [
        {
          name: "A",
          quantity: 1,
          unit: "C62",
          netUnitPrice: 100,
          vat: { category: "S", ratePercent: 19 },
        },
      ],
      paidAmount: 50,
    };
    const c = computeInvoice(inv);
    expect(text(c.grandTotal)).toBe("119.00");
    expect(text(c.duePayable)).toBe("69.00");
  });
});

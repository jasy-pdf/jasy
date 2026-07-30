import { describe, it, expect } from "vitest";
import { computeInvoice, round2 } from "../src/compute";
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
    expect(c.lineNets).toEqual([200, 50]);
    expect(c.lineTotal).toBe(250);
    expect(c.taxBasisTotal).toBe(250);
    // two groups: 19% on 200 → 38, 7% on 50 → 3.5
    expect(c.vatBreakdown).toEqual([
      { category: "S", ratePercent: 19, taxableAmount: 200, taxAmount: 38 },
      { category: "S", ratePercent: 7, taxableAmount: 50, taxAmount: 3.5 },
    ]);
    expect(c.taxTotal).toBe(41.5);
    expect(c.grandTotal).toBe(291.5);
    expect(c.duePayable).toBe(291.5);
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
    expect(c.lineNets).toEqual([24]);
    expect(c.taxTotal).toBe(round2(24 * 0.19)); // 4.56
    expect(c.grandTotal).toBe(28.56);
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
    expect(c.lineTotal).toBe(100);
    expect(c.allowanceTotal).toBe(10);
    expect(c.taxBasisTotal).toBe(90);
    expect(c.vatBreakdown[0].taxableAmount).toBe(90); // 100 - 10
    expect(c.taxTotal).toBe(17.1); // 90 × 19%
    expect(c.grandTotal).toBe(107.1);
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
    expect(c.taxTotal).toBe(0);
    expect(c.grandTotal).toBe(1000);
    expect(c.vatBreakdown[0]).toEqual({
      category: "AE",
      ratePercent: 0,
      taxableAmount: 1000,
      taxAmount: 0,
      exemption: { text: "Reverse charge (§13b UStG)", code: "VATEX-EU-AE" },
    });
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
    expect(c.grandTotal).toBe(119);
    expect(c.duePayable).toBe(69);
  });
});

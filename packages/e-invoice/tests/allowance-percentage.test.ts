import { describe, it, expect } from "vitest";
import { Invoice, AllowanceCharge } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { acAmount } from "../src/allowance.ts";
import { en16931Problems } from "../src/profile-check.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * An allowance stated as "10 % of 1000" instead of "100". The point is not the two extra elements -
 * it is that ONE resolver feeds the totals, both syntaxes and the paper, so a percentage can never
 * be shown as one figure and billed as another.
 */

const base: Invoice = {
  number: "RE-2026-200",
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
      name: "Beratung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 1000,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
};

const withDocAC = (ac: AllowanceCharge): Invoice => ({ ...base, allowancesCharges: [ac] });

const RATE: AllowanceCharge = {
  isCharge: false,
  baseAmount: 1000,
  percent: 10,
  vat: { category: "S", ratePercent: 19 },
  reason: "Mengenrabatt",
};

describe("a percentage becomes an amount, in exactly one place", () => {
  it("derives it", () => {
    expect(acAmount(RATE)).toBe(100);
  });

  it("rounds to the cent, the way money is rounded", () => {
    expect(acAmount({ ...RATE, baseAmount: 33.33, percent: 3 })).toBe(1); // 0.9999
  });

  it("lets an explicit amount win, because overruling a user hides their typo", () => {
    expect(acAmount({ ...RATE, amount: 99 })).toBe(99);
  });

  it("feeds the totals, so the discount actually reduces what is owed", () => {
    const c = computeInvoice(withDocAC(RATE));
    expect(c.allowanceTotal).toBe(100);
    expect(c.taxBasisTotal).toBe(900);
    expect(c.taxTotal).toBe(171); // 19 % of 900, not of 1000
    expect(c.grandTotal).toBe(1071);
  });

  it("gives the same totals whichever way it was written", () => {
    const asRate = computeInvoice(withDocAC(RATE));
    const asAmount = computeInvoice(
      withDocAC({ isCharge: false, amount: 100, vat: RATE.vat, reason: RATE.reason }),
    );
    expect(asRate.grandTotal).toBe(asAmount.grandTotal);
    expect(asRate.taxBasisTotal).toBe(asAmount.taxBasisTotal);
  });
});

describe("both syntaxes carry the rate", () => {
  const invoice = withDocAC(RATE);
  const computed = computeInvoice(invoice);

  it("CII writes percent and basis before the amount, per the XSD sequence", () => {
    const xml = toCII(invoice, computed);
    const block =
      /<ram:SpecifiedTradeAllowanceCharge>[\s\S]*?<\/ram:SpecifiedTradeAllowanceCharge>/.exec(
        xml,
      )![0];
    expect(block).toContain("<ram:CalculationPercent>10</ram:CalculationPercent>");
    expect(block).toContain("<ram:BasisAmount>1000.00</ram:BasisAmount>");
    expect(block.indexOf("CalculationPercent")).toBeLessThan(block.indexOf("BasisAmount"));
    expect(block.indexOf("BasisAmount")).toBeLessThan(block.indexOf("ActualAmount"));
  });

  it("UBL writes the factor before the amount and the base after it", () => {
    const xml = toUBL(invoice, computed);
    const block = /<cac:AllowanceCharge>[\s\S]*?<\/cac:AllowanceCharge>/.exec(xml)![0];
    expect(block).toContain("<cbc:MultiplierFactorNumeric>10</cbc:MultiplierFactorNumeric>");
    expect(block).toContain('<cbc:BaseAmount currencyID="EUR">1000.00</cbc:BaseAmount>');
    expect(block.indexOf("MultiplierFactorNumeric")).toBeLessThan(block.indexOf("cbc:Amount"));
    expect(block.indexOf("cbc:Amount")).toBeLessThan(block.indexOf("BaseAmount"));
  });

  it("writes neither element when the allowance is a plain amount, so old output is untouched", () => {
    const plain = withDocAC({ isCharge: false, amount: 100, vat: RATE.vat });
    const c = computeInvoice(plain);
    expect(toCII(plain, c)).not.toContain("CalculationPercent");
    expect(toUBL(plain, c)).not.toContain("MultiplierFactorNumeric");
  });
});

describe("the paper shows the rate, not just the euros", () => {
  const printed = (invoice: Invoice) =>
    printedText(
      defaultInvoiceTemplate(
        invoice,
        computeInvoice(invoice),
        resolveLabels("de"),
        makeFormatters("de", "EUR"),
      ),
    ).join("\n");

  it("prints the percentage and what it applies to", () => {
    const text = printed(withDocAC(RATE));
    expect(text).toContain("Mengenrabatt");
    expect(text).toMatch(/10\s*%/);
    expect(text).toMatch(/1\.000,00/);
  });

  it("does the same for a line-level rate", () => {
    const text = printed({
      ...base,
      lines: [
        { ...base.lines[0]!, allowancesCharges: [{ ...RATE, baseAmount: 1000, percent: 5 }] },
      ],
    });
    expect(text).toMatch(/5\s*%/);
  });
});

describe("a contradiction is reported, never silently resolved", () => {
  it("names the mismatch when the amount and the rate disagree", () => {
    const problems = en16931Problems(withDocAC({ ...RATE, amount: 90 }));
    expect(problems.join(" ")).toContain("90");
    expect(problems.join(" ")).toContain("100");
  });

  it("accepts a rounding-sized difference, which is not a contradiction", () => {
    expect(
      en16931Problems(withDocAC({ ...RATE, baseAmount: 33.33, percent: 3, amount: 1 })),
    ).toEqual([]);
  });

  it("rejects an impossible rate", () => {
    expect(en16931Problems(withDocAC({ ...RATE, percent: 0 })).join(" ")).toContain("percent");
    expect(en16931Problems(withDocAC({ ...RATE, percent: 120 })).join(" ")).toContain("percent");
  });

  it("finds it on a line too, and says which line", () => {
    const problems = en16931Problems({
      ...base,
      lines: [{ ...base.lines[0]!, allowancesCharges: [{ ...RATE, amount: 55 }] }],
    });
    expect(problems.join(" ")).toContain("invoice.lines[0].allowancesCharges[0]");
  });
});

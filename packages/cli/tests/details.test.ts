import { describe, it, expect } from "vitest";
import { computeInvoice } from "@jasy/e-invoice";
import type { Invoice } from "@jasy/e-invoice";
import { detailLines, lineDetailLines, exportText } from "../src/core/export";
import { maximalInvoice } from "../../e-invoice/tests/support/maximal.ts";

/**
 * The text views show everything the model carries. Run against `maximalInvoice` for the same
 * reason the round-trip is: a field the model gains and the display does not fails here instead of
 * quietly not being shown.
 */

const base: Invoice = {
  number: "RE-1",
  issueDate: "2026-09-09",
  currency: "EUR",
  seller: { name: "S", address: { country: "DE" } },
  buyer: { name: "B", address: { country: "DE" } },
  lines: [
    {
      name: "L",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
};

describe("every field the maximal invoice carries reaches the text", () => {
  const t = computeInvoice(maximalInvoice);
  const text = exportText(maximalInvoice, t);

  it.each([
    ["Skonto, with its deadline", /Skonto\s+2% if paid by 2026-/],
    ["the second Skonto tier with its own base", /Skonto\s+1% if paid by/],
    ["the direct-debit mandate", /Direct debit\s+mandate MARK-MANDATE/],
    ["the creditor id", /creditor MARK-CREDITORID/],
    ["the debited account", /debited MARK-DEBITEDIBAN/],
    ["the preceding invoices", /Corrects\s+MARK-PRECEDING \(2026-06-30\), MARK-PRECEDING2/],
    ["an attachment with its file", /Attached\s+MARK-DOCDESC \(MARK-DOCREF\) - MARK-DOCFILE\.csv/],
    ["an attachment that is a link", /Attached\s+MARK-DOCREF2 - https:\/\/example\.invalid/],
    [
      "a percentage discount as a rate, not only euros",
      /Discount\s+MARK-DOCALLOWANCE \(10% of 200\.00\)\s+-20\.00/,
    ],
    ["a fixed charge", /Charge\s+.*\+15\.00/],
    ["the rounding with its sign", /Rounding\s+\+0\.03/],
    ["the VAT total in the accounting currency", /VAT in CHF\s+42\.50/],
    ["the amount due when it differs from the total", /Due EUR/],
    ["the sales order", /Sales order\s+MARK-SALESORDER/],
    ["the project", /Project\s+MARK-PROJECT/],
    ["the tender", /Tender\s+MARK-TENDER/],
    ["the object", /Object\s+MARK-OBJECT/],
    ["the cost centre", /Cost centre\s+MARK-BUYERACCOUNT/],
    ["a line's order line", /order line MARK-ORDERLINE/],
    ["a line's object", /object MARK-LINEOBJECT/],
    ["a line's cost centre", /cost centre MARK-LINEACCOUNT/],
    ["a line's origin", /origin CH/],
    ["a line's period", /period 2026-07-02 to 2026-07-20/],
    ["a line's percentage discount", /discount MARK-LINEALLOWANCE \(5% of 100\.00\) -5\.00/],
  ])("shows %s", (_what, pattern) => {
    expect(text).toMatch(pattern);
  });
});

describe("what is shown only when it is there", () => {
  it("prints no details block at all for the smallest invoice", () => {
    expect(detailLines(base, computeInvoice(base))).toEqual([]);
    expect(lineDetailLines(base.lines[0]!)).toEqual([]);
  });

  it("prints no Due line when nothing moved the payable", () => {
    expect(exportText(base, computeInvoice(base))).not.toContain("Due");
  });

  it("prints Paid and Due once something is paid", () => {
    const paid = { ...base, paidAmount: 40 };
    const text = exportText(paid, computeInvoice(paid));
    expect(text).toMatch(/Paid\s+-40\.00/);
    expect(text).toMatch(/Due EUR\s+79\.00/);
  });
});

describe("the label column never glues onto its value", () => {
  it("keeps a space after the widest label", () => {
    // "Direct debit" is exactly as wide as the column; a pad alone would produce "Direct debitmandate".
    const dd: Invoice = {
      ...base,
      payment: { meansCode: "59", directDebit: { mandateReference: "M-1" } },
    };
    const line = detailLines(dd, computeInvoice(dd)).find((l) => l.startsWith("Direct debit"));
    expect(line).toBe("Direct debit mandate M-1");
  });
});

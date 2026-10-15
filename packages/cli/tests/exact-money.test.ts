import { describe, it, expect } from "vitest";
import { toCII, toUBL, computeInvoice } from "@jasy/e-invoice";
import { parseCII, parseUBL } from "../src/core/parse";
import { exportText } from "../src/core/export";
import { hardInvoice, hardTotals } from "../../e-invoice/tests/support/hard-numbers.ts";

/**
 * The reader recomputes from what the XML states. A unit price cut to two decimals therefore comes
 * back as a different line total, so the round-trip is the test that catches it.
 */

describe("the hard invoice survives write -> read -> write", () => {
  it("CII", () => {
    const xml = toCII(hardInvoice, computeInvoice(hardInvoice));
    const parsed = parseCII(xml);
    expect(parsed.lines[0]!.netUnitPrice).toBe(1.505);
    expect(toCII(parsed, computeInvoice(parsed))).toBe(xml);
  });

  it("UBL", () => {
    const xml = toUBL(hardInvoice, computeInvoice(hardInvoice));
    const parsed = parseUBL(xml);
    expect(parsed.lines[0]!.netUnitPrice).toBe(1.505);
    expect(toUBL(parsed, computeInvoice(parsed))).toBe(xml);
  });
});

describe("the text view prints the exact figures", () => {
  const text = exportText(hardInvoice, computeInvoice(hardInvoice));

  it.each([
    ["the line totals", /Cable\s+4\.52\n/],
    ["a return, away from zero", /Cable returned\s+-4\.52\n/],
    ["the line with its discount", /Adapter\s+7\.10\n/],
    ["the net", /Net\s+73\.00/],
    ["the VAT", /VAT\s+10\.22/],
    ["the total", /Total EUR\s+83\.22/],
    ["the Skonto on the total", /81\.56 EUR \(saves 1\.66\)/],
    ["the Skonto on its own base", /7\.10 EUR \(saves 0\.15\)/],
    ["the percentage discount", /\(1% of 14\.50\)\s+-0\.15/],
  ])("%s", (_what, pattern) => {
    expect(text).toMatch(pattern);
  });

  it("matches the integer figures", () => {
    expect(text).toContain(hardTotals.grandTotal);
  });
});

import { describe, it, expect } from "vitest";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend.ts";

// A shaped run used to return `[]` from `getKernPairs` - no kerning at all - because the `TJ` operand was
// built from TEXT, which a shaped run cannot be expressed as. Both paths now share one chunking, over
// characters or over glyph ids.

const chars = (chunk: string[]) => `(${chunk.join("")})`;
const glyphs = (chunk: number[]) =>
  `<${chunk.map((g) => g.toString(16).padStart(4, "0").toUpperCase()).join("")}>`;

describe("the TJ operand", () => {
  it("splits a character run only where a pair kerns", () => {
    // The sign flips: a TJ number moves the pen LEFT, so it is the negated kern.
    expect(PdfBackend.kernedArray([..."Total"], [-170, 0, 0, 0], chars)).toBe("[(T) 170 (otal)]");
  });

  it("splits a glyph run the same way", () => {
    expect(PdfBackend.kernedArray([1, 2, 3], [-40, 0], glyphs)).toBe("[<0001> 40 <00020003>]");
  });

  it("keeps one chunk when nothing kerns", () => {
    expect(PdfBackend.kernedArray([1, 2, 3], [0, 0], glyphs)).toBe("[<000100020003>]");
  });

  it("kerns every gap", () => {
    expect(PdfBackend.kernedArray([1, 2, 3], [-10, -20], glyphs)).toBe(
      "[<0001> 10 <0002> 20 <0003>]",
    );
  });

  it("handles a single unit, which has no gaps at all", () => {
    expect(PdfBackend.kernedArray([7], [], glyphs)).toBe("[<0007>]");
  });

  it("refuses a kern count that does not match the gaps", () => {
    // The guard is the whole point: the loop walks the gaps, so a short list drops the last unit
    // silently. An empty run has no gaps either, and used to slip past the check entirely.
    expect(() => PdfBackend.kernedArray([1, 2, 3], [0], glyphs)).toThrow(/expected 2/);
    expect(() => PdfBackend.kernedArray([], [-10], glyphs)).toThrow(/expected 0/);
    expect(PdfBackend.kernedArray([], [], glyphs)).toBe("[<>]");
  });
});

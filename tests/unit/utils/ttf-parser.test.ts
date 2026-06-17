import { describe, it, expect } from "vitest";
import { TTFParser } from "../../../src/lib/utils/ttf-parser";
import { buildTestTtf } from "./ttf-fixture";

describe("TTFParser", () => {
  const font = new TTFParser(buildTestTtf());

  it("reads unitsPerEm from head", () => {
    expect(font.unitsPerEm).toBe(1000);
  });

  it("maps characters to glyphs via cmap (0 for the unmapped)", () => {
    expect(font.getGlyphIndex(0x41)).toBe(1); // A
    expect(font.getGlyphIndex(0x42)).toBe(2); // B
    expect(font.getGlyphIndex(0x20)).toBe(3); // space
    expect(font.getGlyphIndex(0x2603)).toBe(0); // snowman → .notdef
  });

  it("reads advance widths from hmtx", () => {
    expect(font.getAdvanceWidth(1)).toBe(500);
    expect(font.getAdvanceWidth(2)).toBe(700);
  });

  it("computes string width scaled by fontSize / unitsPerEm", () => {
    expect(font.getStringWidth("A", 1000)).toBe(500);
    expect(font.getStringWidth("A", 12)).toBeCloseTo(6, 5); // 500/1000 * 12
    expect(font.getStringWidth("AB", 12)).toBeCloseTo(14.4, 5); // (500+700)/1000 * 12
    expect(font.getStringWidth("A B", 12)).toBeCloseTo(((500 + 250 + 700) / 1000) * 12, 5);
  });

  it("throws on a missing required table", () => {
    expect(() => new TTFParser(Buffer.alloc(12))).toThrow(/missing required table/);
  });
});

import { describe, it, expect } from "vitest";
import { TTFParser } from "../../../src/lib/utils/ttf-parser";
import {
  buildTestTtf,
  buildOutlineTtf,
  buildQuadTtf,
  buildColorTtf,
  buildColorV1Ttf,
  buildDualCmapTtf,
} from "./ttf-fixture";

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

  it("reads BOTH a BMP (format 4) and an astral (format 12) cmap subtable", () => {
    // Real emoji fonts ship both; reading only the first subtable would drop astral coverage.
    const dual = new TTFParser(buildDualCmapTtf(0x1f600));
    expect(dual.getGlyphIndex(0x41)).toBe(1); // 'A' via the format-4 BMP subtable
    expect(dual.getGlyphIndex(0x1f600)).toBe(2); // 😀 via the format-12 astral subtable
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

describe("TTFParser - glyf outlines", () => {
  it("reports no outlines when glyf/loca are absent (metric-only font)", () => {
    expect(new TTFParser(buildTestTtf()).hasGlyfOutlines()).toBe(false);
  });

  it("parses a simple square glyph into move/line/close commands", () => {
    const font = new TTFParser(buildOutlineTtf(0x1f600));
    expect(font.hasGlyfOutlines()).toBe(true);

    const gid = font.getGlyphIndex(0x1f600);
    const path = font.getGlyphPath(gid);

    // A 4-corner square, all on-curve: one moveTo, three lineTo, one close - no quads.
    expect(path).toEqual([
      { type: "M", x: 100, y: 100 },
      { type: "L", x: 100, y: 900 },
      { type: "L", x: 900, y: 900 },
      { type: "L", x: 900, y: 100 },
      { type: "Z" },
    ]);
  });

  it("converts an off-curve control point into a quadratic segment", () => {
    const font = new TTFParser(buildQuadTtf(0x1f600));
    const path = font.getGlyphPath(font.getGlyphIndex(0x1f600));

    // on(0,0) -> off(500,1000) -> on(1000,0): one quad through the control, then Z closes the base.
    expect(path).toEqual([
      { type: "M", x: 0, y: 0 },
      { type: "Q", cx: 500, cy: 1000, x: 1000, y: 0 },
      { type: "Z" },
    ]);
  });

  it("returns an empty outline for a glyph without one (.notdef)", () => {
    expect(new TTFParser(buildOutlineTtf()).getGlyphPath(0)).toEqual([]);
  });
});

describe("TTFParser - COLR/CPAL color glyphs", () => {
  it("reports no color glyphs for a plain outline font", () => {
    expect(new TTFParser(buildOutlineTtf()).hasColorGlyphs()).toBe(false);
  });

  it("resolves a v0 base glyph's layers to outline glyph ids + solid palette colors", () => {
    const font = new TTFParser(buildColorTtf(0x1f600));
    expect(font.hasColorGlyphs()).toBe(true);

    const base = font.getGlyphIndex(0x1f600);
    const layers = font.getColorGlyph(base);

    // Two layers, back to front: square in palette 0 (red), curve in palette 1 (blue).
    expect(layers).toEqual([
      { glyphId: 2, paint: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } } },
      { glyphId: 3, paint: { type: "solid", color: { r: 0, g: 0, b: 255, a: 255 } } },
    ]);
    // The layer glyph ids point at real outlines we can draw.
    expect(font.getGlyphPath(2).length).toBeGreaterThan(0);
    expect(font.getGlyphPath(3).length).toBeGreaterThan(0);
  });

  it("returns null for a glyph that has no color layers", () => {
    const font = new TTFParser(buildColorTtf());
    expect(font.getColorGlyph(2)).toBeNull(); // a layer glyph itself is not a base glyph
  });

  it("walks a COLR v1 paint graph: ColrLayers -> PaintGlyph -> Solid + LinearGradient", () => {
    const font = new TTFParser(buildColorV1Ttf(0x1f600));
    expect(font.hasColorGlyphs()).toBe(true);

    const layers = font.getColorGlyph(font.getGlyphIndex(0x1f600));
    expect(layers).toHaveLength(2);

    // Layer 0: the square, a solid red fill.
    expect(layers![0]).toEqual({
      glyphId: 2,
      paint: { type: "solid", color: { r: 255, g: 0, b: 0, a: 255 } },
    });

    // Layer 1: the curve, a vertical linear gradient red (stop 0) -> blue (stop 1).
    const grad = layers![1];
    expect(grad.glyphId).toBe(3);
    expect(grad.paint.type).toBe("linearGradient");
    if (grad.paint.type === "linearGradient") {
      expect(grad.paint.p0).toEqual([0, 0]);
      expect(grad.paint.p1).toEqual([0, 100]);
      expect(grad.paint.extend).toBe("pad");
      expect(grad.paint.stops).toEqual([
        { offset: 0, color: { r: 255, g: 0, b: 0, a: 255 } },
        { offset: 1, color: { r: 0, g: 0, b: 255, a: 255 } },
      ]);
    }
  });
});

import { describe, it, expect } from "vitest";
import {
  skipInkSegments,
  strikethroughStroke,
  underlineStroke,
} from "../../../src/lib/text/text-decoration";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";

// Every number an underline or a strikethrough uses comes out of the font. Verified against
// `google-chrome --headless --print-to-pdf` on the SAME font (FreeSans): Chrome's strikethrough
// centre sits on xHeight/2 and its `from-font` stroke is the font's underlineThickness.

const helvetica = () => {
  const om = new PDFObjectManager();
  om.registerFont("Helvetica", FontStyle.Normal, "Helvetica");
  om.registerFont("Symbol", FontStyle.Normal, "Symbol");
  return om;
};

describe("decoration metrics come from the font", () => {
  it("reads Helvetica's underline and heights out of its AFM header", () => {
    // Helvetica.afm: UnderlinePosition -100, UnderlineThickness 50, CapHeight 718, XHeight 523.
    const d = helvetica().getFontDecoration("Helvetica", FontStyle.Normal);
    expect(d.underlinePosition).toBeCloseTo(0.1); // positive = BELOW the baseline
    expect(d.underlineThickness).toBeCloseTo(0.05);
    expect(d.capHeight).toBeCloseTo(0.718);
    expect(d.xHeight).toBeCloseTo(0.523);
  });

  it("falls back to the bbox for a font with no lowercase (Symbol has no XHeight)", () => {
    // Symbol.afm carries no CapHeight/XHeight at all. Its FontBBox top is 1010.
    const d = helvetica().getFontDecoration("Symbol", FontStyle.Normal);
    expect(d.capHeight).toBeCloseTo(1.01);
    expect(d.xHeight).toBeCloseTo(0.505); // half of it, so a strikethrough still crosses the glyphs
  });
});

describe("stroke geometry", () => {
  const d = { underlinePosition: 0.1, underlineThickness: 0.05, xHeight: 0.5, capHeight: 0.7 };

  it("puts the underline below the baseline, the strikethrough above it", () => {
    expect(underlineStroke(d, 100, 500)).toEqual({ y: 510, thickness: 5 });
    expect(strikethroughStroke(d, 100, 500)).toEqual({ y: 475, thickness: 5 });
  });

  it("scales both with the font size", () => {
    expect(underlineStroke(d, 10, 0).y).toBeCloseTo(1);
    expect(underlineStroke(d, 20, 0).y).toBeCloseTo(2);
  });
});

describe("skipInkSegments", () => {
  const THICK = 2; // so the padding around a descender is 2pt on each side

  it("returns the whole run when nothing dips into the stroke", () => {
    expect(skipInkSegments(100, [], THICK)).toEqual([[0, 100]]);
  });

  it("cuts a gap around each descender, padded by the stroke thickness", () => {
    expect(skipInkSegments(100, [[40, 50]], THICK)).toEqual([
      [0, 38],
      [52, 100],
    ]);
  });

  it("merges two descenders that sit closer together than the padding", () => {
    // Gaps 38..52 and 51..65 overlap, so no sliver of line survives between them.
    expect(
      skipInkSegments(
        100,
        [
          [40, 50],
          [53, 63],
        ],
        THICK,
      ),
    ).toEqual([
      [0, 38],
      [65, 100],
    ]);
  });

  it("drops a segment narrower than the padding rather than drawing dirt", () => {
    expect(skipInkSegments(100, [[1, 99]], THICK)).toEqual([]);
  });

  it("keeps the run's own bounds (a descender at the very edge does not overhang)", () => {
    const [first] = skipInkSegments(100, [[0, 10]], THICK);
    expect(first[0]).toBeGreaterThanOrEqual(12);
  });
});

describe("skipInk without glyph outlines", () => {
  it("refuses on a standard-14 font instead of silently drawing a solid line", async () => {
    const { Document, Page, Text, renderToBytes } = await import("../../../src/lib/api");
    await expect(
      renderToBytes(
        Document([Page({}, [Text("Hxgp", { size: 40, underline: true, skipInk: true })])]),
      ),
    ).rejects.toThrow(/skipInk needs an embedded font/);
  });
});

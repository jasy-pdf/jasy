import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { buildTestTtf, buildAstralTtf } from "./ttf-fixture";

describe("PDFObjectManager - custom font metric routing (slice 2.1)", () => {
  it("measures a registered TTF via its own metrics (A=500, B=700 units @ em 1000)", () => {
    const om = new PDFObjectManager();
    om.registerCustomFont("MyFont", buildTestTtf());
    expect(om.getStringWidth("A", "MyFont", 1000, FontStyle.Normal)).toBeCloseTo(500, 5);
    expect(om.getStringWidth("AB", "MyFont", 12, FontStyle.Normal)).toBeCloseTo(14.4, 5);
    expect(om.getStringWidth("A B", "MyFont", 12, FontStyle.Normal)).toBeCloseTo(
      ((500 + 250 + 700) / 1000) * 12,
      5,
    );
  });

  it("leaves the standard-14 (AFM) path intact", () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica");
    expect(om.getStringWidth("Hello", "Helvetica", 12, FontStyle.Normal)).toBeGreaterThan(0);
  });

  it("measures an astral code point (emoji) as ONE glyph, not two half-surrogates", () => {
    const om = new PDFObjectManager();
    om.registerCustomFont("Emoji", buildAstralTtf(0x1f600, 900)); // 😀 -> 900 units @ em 1000
    // The emoji is a UTF-16 surrogate PAIR. Code-point iteration measures it as the single 900-unit
    // glyph; the old unit-by-unit loop would have seen two unmapped halves (0 + 0 width).
    expect(om.getStringWidth("😀", "Emoji", 12, FontStyle.Normal)).toBeCloseTo(
      (900 / 1000) * 12,
      5,
    );
    // And it composes with BMP text rather than corrupting the surrounding measurement.
    expect(om.getStringWidth("😀😀", "Emoji", 12, FontStyle.Normal)).toBeCloseTo(
      2 * (900 / 1000) * 12,
      5,
    );
  });

  it("measures an unrepresentable astral char on the standard path as a single fallback glyph", () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica");
    // A standard (WinAnsi) font cannot encode an emoji; the encoder draws one "?" for it, so the
    // width must equal one "?" - not two (which the old UTF-16-unit loop produced).
    const oneFallback = om.getStringWidth("?", "Helvetica", 12, FontStyle.Normal);
    expect(om.getStringWidth("😀", "Helvetica", 12, FontStyle.Normal)).toBeCloseTo(oneFallback, 5);
  });
});

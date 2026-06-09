import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "./pdf-object-manager";

// Independently-verified font-metric oracle - the refactor safety net.
//
// Unlike the other suites, these expected numbers are NOT read back from the code
// or from mocks. They are the published Adobe metrics for the standard-14 fonts;
// the .afm files in ../assets are the authoritative source. If the engine returns a
// different value, the engine is wrong - not the test.
//
// All values are PDF points (1/72"), never pixels. As metrics move out of
// PDFObjectManager in later phases, only `stringWidth` below should need updating.

// The single point coupled to the current metrics API. Change this adapter - not the
// expectations - when the call surface moves in a later phase.
function stringWidth(
  text: string,
  font: string,
  size: number,
  style: FontStyle = FontStyle.Normal
): number {
  const m = new PDFObjectManager();
  m.registerFont(font, style); // loads the matching .afm parser
  return m.getStringWidth(text, font, size, style);
}

describe("font metrics - Adobe AFM oracle (points)", () => {
  // Single-glyph advances at 1000pt equal the raw AFM units. Anchored on famous
  // constants (Helvetica space = 278, Times space = 250) so the check does not
  // depend on the parser being correct to define its own expectation.
  it("anchors single-glyph advances to raw AFM units", () => {
    expect(stringWidth(" ", "Helvetica", 1000)).toBeCloseTo(278, 6);
    expect(stringWidth("A", "Helvetica", 1000)).toBeCloseTo(667, 6);
    expect(stringWidth(" ", "Times-Roman", 1000)).toBeCloseTo(250, 6);
    expect(stringWidth("A", "Times-Roman", 1000)).toBeCloseTo(722, 6);
  });

  // Kerning must be looked up per ordered pair, with the right sign and scaled by
  // font size. assets/Helvetica.afm: KPX A V -70, KPX V A -80.
  it("applies kerning with the correct pair, sign and scale", () => {
    // "AV" @12pt = adv(A) + adv(V) + kern(A,V) = 8.004 + 8.004 - 0.84 = 15.168
    expect(stringWidth("AV", "Helvetica", 12)).toBeCloseTo(15.168, 6);
    // "VA" @12pt uses the other pair: kern(V,A) = -80 -> 16.008 - 0.96 = 15.048
    expect(stringWidth("VA", "Helvetica", 12)).toBeCloseTo(15.048, 6);
  });

  // Multi-char width is the sum of advances plus every interior kern pair.
  it("sums advances and kernings across a word", () => {
    // "AVA" @12pt = 3*8.004 + kern(A,V) + kern(V,A) = 24.012 - 0.84 - 0.96 = 22.212
    expect(stringWidth("AVA", "Helvetica", 12)).toBeCloseTo(22.212, 6);
  });
});

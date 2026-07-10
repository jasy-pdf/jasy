import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";

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
  style: FontStyle = FontStyle.Normal,
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

  // A string's width is the PLAIN sum of its advances - NO kerning.
  //
  // This is not an oversight, it is the contract: we write a run as one `Tj`, and a viewer advances
  // that by the font's widths. PDF never kerns on its own; a producer has to say so with a `TJ`
  // array, and we do not. Folding the AFM's kern pairs into the measurement while the output ignored
  // them made every kerned string DRAW wider than the box it was measured into ("AVATAR Wave" at
  // 40pt: 19pt too wide; "Total" at 11pt: 5.7%). Measured must equal drawn.
  //
  // The kern pairs are still parsed (`AFMParser.getKerning`) for the day we emit `TJ`. When that
  // lands, these expectations change - and so must the backend, in the same commit.
  it("sums advances without kerning, because a Tj is advanced without kerning", () => {
    // assets/Helvetica.afm: adv(A) = adv(V) = 667. It also declares KPX A V -70, KPX V A -80,
    // and neither may show up here.
    expect(stringWidth("AV", "Helvetica", 12)).toBeCloseTo(16.008, 6); // NOT 15.168
    expect(stringWidth("VA", "Helvetica", 12)).toBeCloseTo(16.008, 6); // NOT 15.048
    expect(stringWidth("AVA", "Helvetica", 12)).toBeCloseTo(24.012, 6); // NOT 22.212
  });

  it("is order-independent, which a kerned measure could never be", () => {
    expect(stringWidth("AV", "Helvetica", 12)).toBeCloseTo(stringWidth("VA", "Helvetica", 12), 9);
  });
});

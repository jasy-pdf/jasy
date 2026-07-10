import { describe, it, expect } from "vitest";
import { lineBoxFor } from "../../../src/lib/text/line-metrics";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";

// ISSUE-5: the baseline used to be a hard-coded 683/1000 - Times-Roman's `Ascender`, applied to
// every face - and the line box was assumed to be 1 em tall while a font's content is
// `ascent + descent`. Both numbers now come out of the font itself.
//
// And `Ascender` was the wrong LINE metric to reach for even for Times: it is the height of the
// ascender LETTERS (b, d, h), not how far a line must reach to clear an accented capital. The
// standard-14 line metric is the `FontBBox`, which is what TrueType's `hhea.ascent` corresponds to.
// Using it puts capitals optically centred, matching a browser to within a third of a point.

const om = () => {
  const m = new PDFObjectManager();
  m.registerFont("Helvetica", FontStyle.Normal, "Helvetica");
  m.registerFont("Times-Roman", FontStyle.Normal, "Times-Roman");
  m.registerFont("Courier", FontStyle.Normal, "Courier");
  return m;
};

describe("font verticals come from the font, not from a constant", () => {
  it("takes each standard-14 face's line metric from its FontBBox", () => {
    const m = om();
    // Helvetica AFM: FontBBox -166 -225 1000 931. (Its `Ascender 718` is the height of b/d/h.)
    const helv = m.getFontVerticals("Helvetica", FontStyle.Normal);
    expect(helv.ascent).toBeCloseTo(0.931);
    expect(helv.descent).toBeCloseTo(0.225);
    expect(helv.lineGap).toBe(0); // the bbox already IS the full extent

    // Times-Roman: FontBBox -168 -218 1000 898. Courier: -23 -250 715 805.
    expect(m.getFontVerticals("Times-Roman", FontStyle.Normal).ascent).toBeCloseTo(0.898);
    expect(m.getFontVerticals("Courier", FontStyle.Normal).ascent).toBeCloseTo(0.805);
  });

  it("no longer seats every face at Times-Roman's 0.683 ascender", () => {
    const m = om();
    for (const family of ["Helvetica", "Times-Roman", "Courier"]) {
      expect(m.getFontVerticals(family, FontStyle.Normal).ascent).not.toBeCloseTo(0.683);
    }
  });

  it("leaves room above the capitals, about as much as the descent below", () => {
    // This is what makes an all-caps word sit optically centred (Chrome and react-pdf agree).
    const m = om();
    const CAP_HEIGHT = 0.718; // Helvetica's capitals
    const { ascent, descent } = m.getFontVerticals("Helvetica", FontStyle.Normal);
    const aboveCaps = ascent - CAP_HEIGHT;
    expect(aboveCaps).toBeGreaterThan(0);
    expect(Math.abs(aboveCaps - descent)).toBeLessThan(0.04); // 0.213 vs 0.225
  });
});

describe("lineBoxFor", () => {
  // Helvetica's FontBBox, as `getFontVerticals` reports it.
  const helvetica = { ascent: 0.931, descent: 0.225, lineGap: 0 };

  it("centres the content in its box: the air above equals the air below", () => {
    const { height, baseline } = lineBoxFor([{ verticals: helvetica, fontSize: 60 }]);
    const airAbove = baseline - helvetica.ascent * 60;
    const airBelow = height - baseline - helvetica.descent * 60;
    expect(airAbove).toBeCloseTo(airBelow);
  });

  it("an unset lineHeight is the font's natural line height", () => {
    const { height } = lineBoxFor([{ verticals: helvetica, fontSize: 100 }]);
    expect(height).toBeCloseTo(115.6); // 931 + 225
  });

  it("seats the baseline at the ascent when the box has no leading to split", () => {
    const { baseline } = lineBoxFor([{ verticals: helvetica, fontSize: 100 }]);
    expect(baseline).toBeCloseTo(93.1); // NOT 68.3, which is what the old constant gave
  });

  it("an explicit lineHeight is a multiplier of the font size, and still half-leads", () => {
    const { height, baseline } = lineBoxFor([{ verticals: helvetica, fontSize: 10 }], 1.8);
    expect(height).toBeCloseTo(18);
    // half-leading against the REAL content height (1.156 em), not against 1 em:
    // (18 - 11.56) / 2 + 9.31 = 12.53
    expect(baseline).toBeCloseTo(12.53);
  });

  it("a box tighter than the content overflows evenly, as CSS does", () => {
    const { height, baseline } = lineBoxFor([{ verticals: helvetica, fontSize: 10 }], 0.5);
    expect(height).toBe(5);
    const airAbove = baseline - 9.31;
    const airBelow = height - baseline - 2.25;
    expect(airAbove).toBeCloseTo(airBelow); // both negative, symmetric
    expect(airAbove).toBeLessThan(0);
  });

  it("a mixed-font line takes the tallest ascent and the deepest descent on it", () => {
    const small = { ascent: 0.7, descent: 0.2, lineGap: 0 };
    const deep = { ascent: 0.5, descent: 0.6, lineGap: 0 };
    const { height, baseline } = lineBoxFor([
      { verticals: small, fontSize: 10 },
      { verticals: deep, fontSize: 10 },
    ]);
    expect(baseline).toBeCloseTo(7); // the tallest ascent seats the baseline
    expect(height).toBeCloseTo(13); // 7 up + 6 down: the deep descender still fits
  });
});

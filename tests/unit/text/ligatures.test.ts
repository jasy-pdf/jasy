import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { runAdvance } from "../../../src/lib/text/advance.ts";
import { buildLigatureTtf } from "../utils/ttf-fixture.ts";

// Latin ligatures are ON, like kerning: the font's designer drew them, every other renderer applies
// them, and nobody should need the word to get text set properly. `ligatures: false` opts out - on a
// Document, a DefaultTextStyle subtree or one Text, since it is an inheritable text style.
//
// The fixture font merges A+B into glyph 4 and kerns that ligature against the space by -80.

const FONT = { fontFamily: "Lig", fontSize: 10, fontStyle: FontStyle.Normal };

const om = (kerning = false) => {
  const m = new PDFObjectManager();
  m.registerCustomFont("Lig", new Uint8Array(buildLigatureTtf()));
  m.setKerning(kerning);
  return m;
};

describe("on by default", () => {
  it("merges the pair into one glyph", () => {
    expect(
      om()
        .shapeText("AB ", "Lig", FontStyle.Normal)!
        .map((g) => g.glyph),
    ).toEqual([4, 3]);
  });

  it("keeps the code points the ligature stands for, so copied text is still AB", () => {
    expect(
      om()
        .shapeText("AB ", "Lig", FontStyle.Normal)!
        .map((g) => g.codePoints),
    ).toEqual([[0x41, 0x42], [0x20]]);
  });

  it("measures the ligature's own advance, not the sum of its parts", () => {
    // glyph 4 (600) + space (250) at 10pt/1000upem - narrower than A(500) + B(700) + space(250).
    expect(runAdvance(om(), "AB ", FONT, 0)).toBeCloseTo(8.5, 5);
  });

  it("still kerns, over the SHAPED glyphs", () => {
    // Why shaped-run kerning had to come first: this run would otherwise lose -80.
    expect(om(true).getKernPairs("AB ", "Lig", FontStyle.Normal)).toEqual([-80]);
    expect(runAdvance(om(true), "AB ", FONT, 0)).toBeCloseTo(7.7, 5);
  });
});

describe("switched off", () => {
  const off = { ...FONT, ligatures: false };

  it("does not shape, so the run keeps its plain path", () => {
    expect(om().shapeText("AB ", "Lig", FontStyle.Normal, [])).toBeUndefined();
  });

  it("measures the letters apart", () => {
    expect(runAdvance(om(), "AB ", off, 0)).toBeCloseTo(14.5, 5);
  });

  it("measures what it draws either way - the two settings must not agree by accident", () => {
    expect(runAdvance(om(), "AB ", FONT, 0)).not.toBeCloseTo(runAdvance(om(), "AB ", off, 0), 5);
  });
});

describe("a font with no such feature", () => {
  it("is left alone, so its documents stay byte-identical", () => {
    // No lookup covers this pair, so nothing merges and the plain path is kept.
    expect(om().shapeText("BA ", "Lig", FontStyle.Normal)).toBeUndefined();
  });
});

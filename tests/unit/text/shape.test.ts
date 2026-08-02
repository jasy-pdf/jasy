import { describe, it, expect } from "vitest";
import { shapeRun, type ShapingFont } from "../../../src/lib/text/shape.ts";
import { GsubTable } from "../../../src/lib/utils/gsub.ts";
import { buildGsub, coverage1, single1, ligature } from "../support/gsub-builder.ts";

// Shaping is where Unicode's answer (WHICH form) meets the font's answer (which GLYPH). The font here
// is a stand-in with a made-up glyph numbering, so the tests read as "the initial form of beh", not as
// "glyph 5259" - and they stay true whatever real font is used.

const BEH = 0x0628; // dual-joining
const ALEF = 0x0627; // right-joining
const LAM = 0x0644; // dual-joining
const A = 0x0061;

// Base glyphs: one per letter. The joining forms live 100/200/300 above the base, so a test can read
// "beh + 100" as "the initial beh" - which is exactly what the delta-based lookups below produce.
const base: Record<number, number> = { [BEH]: 10, [ALEF]: 20, [LAM]: 30, [A]: 40 };
const INIT = 100,
  MEDI = 200,
  FINA = 300;
const LAM_ALEF = 999;

const gsub = new GsubTable(
  buildGsub(
    [
      { tag: "init", lookups: [0] },
      { tag: "medi", lookups: [1] },
      { tag: "fina", lookups: [2] },
      { tag: "rlig", lookups: [3] },
    ],
    [
      { type: 1, subtables: [single1(coverage1([10, 20, 30]), INIT)] },
      { type: 1, subtables: [single1(coverage1([10, 30]), MEDI)] },
      { type: 1, subtables: [single1(coverage1([10, 20, 30]), FINA)] },
      // The initial lam followed by the final alef collapses - which IS lam-alef, the one ligature
      // Arabic is not allowed to draw apart.
      { type: 4, subtables: [ligature(coverage1([30 + INIT]), [[[LAM_ALEF, 20 + FINA]]])] },
    ],
  ),
  0,
);

/** Every glyph is 100 units wide except the ligature, so a merge is visible in the advance too. */
const font: ShapingFont = {
  gsub: () => gsub,
  getGlyphIndex: (cp) => base[cp] ?? 0,
  getAdvanceWidth: (glyph) => (glyph === LAM_ALEF ? 150 : 100),
};

const shape = (text: string) =>
  shapeRun(
    [...text].map((c) => c.codePointAt(0)!),
    font,
  );

describe("nothing to shape", () => {
  it("leaves Latin alone, so no existing document changes", () => {
    expect(shape("abc")).toBeUndefined();
  });

  it("leaves a font without the script alone", () => {
    const noArabic: ShapingFont = { ...font, gsub: () => undefined };
    expect(shapeRun([BEH, BEH], noArabic)).toBeUndefined();
  });
});

describe("joining forms become glyphs", () => {
  it("gives each letter of a word its own form", () => {
    // beh-beh-beh: initial, medial, final.
    expect(shape("ببب")!.map((g) => g.glyph)).toEqual([10 + INIT, 10 + MEDI, 10 + FINA]);
  });

  it("leaves a lone letter in its base (isolated) glyph", () => {
    // There is no `isol` lookup here, which is the normal case: the plain glyph already IS that form.
    expect(shape("ب")!.map((g) => g.glyph)).toEqual([10]);
  });

  it("breaks the join after a right-joining letter", () => {
    // beh-alef-beh: the alef ends the connection, so the second beh starts a new one.
    expect(shape("باب")!.map((g) => g.glyph)).toEqual([10 + INIT, 20 + FINA, 10]);
  });

  it("keeps one code point per glyph when nothing merges", () => {
    expect(shape("ببب")!.map((g) => g.codePoints)).toEqual([[BEH], [BEH], [BEH]]);
  });
});

describe("required ligatures", () => {
  it("collapses lam-alef into one glyph", () => {
    const shaped = shape("لا")!;
    expect(shaped.map((g) => g.glyph)).toEqual([LAM_ALEF]);
  });

  it("carries BOTH code points on the merged glyph, or copied text would lose a letter", () => {
    expect(shape("لا")!.map((g) => g.codePoints)).toEqual([[LAM, ALEF]]);
  });

  it("takes the advance of the ligature, not of the parts it replaced", () => {
    // 150, not 2 x 100 - the whole reason a joined word is narrower than an unjoined one.
    expect(shape("لا")!.reduce((w, g) => w + g.advance, 0)).toBe(150);
  });

  it("only merges where the ligature actually matches", () => {
    // alef-lam is not lam-alef: the same two letters the other way round must stay two glyphs.
    expect(shape("ال")!.length).toBe(2);
  });
});

describe("the advance a shaped run reports", () => {
  it("is the sum of the SHAPED glyphs, which is what makes measured equal drawn", () => {
    expect(shape("ببب")!.reduce((w, g) => w + g.advance, 0)).toBe(300);
  });
});

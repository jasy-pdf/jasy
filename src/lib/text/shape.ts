import { joiningForms, needsJoining, type JoiningForm } from "./arabic.ts";
import type { GsubTable } from "../utils/gsub.ts";

/**
 * SHAPING: code points in, the glyphs actually drawn out. Where the two halves meet - `arabic.ts`
 * says WHICH positional form a letter takes, `gsub.ts` says which GLYPH that form is in this font.
 *
 * Not a string, because a ligature is one glyph for several code points. `codePoints` carries the
 * origin so `ToUnicode` can still say what the glyph means.
 */

/** One drawn glyph, with the code points it came from. */
export interface ShapedGlyph {
  glyph: number;
  /** Advance in FONT UNITS - the caller scales by fontSize / unitsPerEm, as everywhere else. */
  advance: number;
  /** The code points this glyph stands for; more than one only for a ligature. */
  codePoints: number[];
}

/** The little a font has to answer for shaping - deliberately not the whole `TTFParser`. */
export interface ShapingFont {
  gsub(): GsubTable | undefined;
  getGlyphIndex(codePoint: number): number;
  getAdvanceWidth(glyph: number): number;
}

/** The features that realise the four positional forms, in the order a shaper applies them. */
const FORM_FEATURES: Record<JoiningForm, string> = {
  isol: "isol",
  init: "init",
  medi: "medi",
  fina: "fina",
};

/**
 * Shape a run, or `undefined` when there is nothing to do - so untouched documents keep their path.
 *
 * `rlig` (required ligatures - lam-alef, wrong when drawn apart) but not `liga`, which is
 * discretionary and would change how existing Latin text looks.
 */
export function shapeRun(
  codePoints: readonly number[],
  font: ShapingFont,
): ShapedGlyph[] | undefined {
  if (!needsJoining(codePoints)) return undefined;
  const gsub = font.gsub();
  if (!gsub || !gsub.hasScript("arab")) return undefined;

  const forms = joiningForms(codePoints);
  let glyphs: ShapedGlyph[] = codePoints.map((cp, i) => {
    let glyph = font.getGlyphIndex(cp);
    const form = forms[i];
    if (form) {
      // First lookup that covers the glyph wins. A missing `isol` is normal: the plain glyph already
      // IS that form.
      for (const lookup of gsub.lookups("arab", FORM_FEATURES[form])) {
        const substituted = gsub.substituteSingle(lookup, glyph);
        if (substituted !== null) {
          glyph = substituted;
          break;
        }
      }
    }
    return { glyph, advance: font.getAdvanceWidth(glyph), codePoints: [cp] };
  });

  glyphs = applyLigatures(glyphs, gsub, font);
  return glyphs;
}

/** Collapse required ligatures, longest match first, carrying every component's code points along. */
function applyLigatures(glyphs: ShapedGlyph[], gsub: GsubTable, font: ShapingFont): ShapedGlyph[] {
  const lookups = gsub.lookups("arab", "rlig");
  if (lookups.length === 0) return glyphs;

  const ids = glyphs.map((g) => g.glyph);
  const out: ShapedGlyph[] = [];
  for (let i = 0; i < glyphs.length; ) {
    let applied = false;
    for (const lookup of lookups) {
      const match = gsub.substituteLigature(lookup, ids, i);
      if (!match) continue;
      out.push({
        glyph: match.glyph,
        advance: font.getAdvanceWidth(match.glyph),
        codePoints: glyphs.slice(i, i + match.consumed).flatMap((g) => g.codePoints),
      });
      i += match.consumed;
      applied = true;
      break;
    }
    if (!applied) out.push(glyphs[i++]);
  }
  return out;
}

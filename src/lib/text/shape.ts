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
 * Arabic always applies `rlig` - lam-alef is wrong when drawn apart. Latin applies whatever `features`
 * asks for, which is `liga` today; the list is the seam a general `fontFeatures` would use.
 */
export function shapeRun(
  codePoints: readonly number[],
  font: ShapingFont,
  features: readonly string[] = [],
): ShapedGlyph[] | undefined {
  const gsub = font.gsub();
  if (!gsub) return undefined;
  if (!needsJoining(codePoints)) {
    // Latin: no joining, only the substitutions the caller asked for.
    return features.length > 0 ? shapeLatin(codePoints, font, gsub, features) : undefined;
  }
  if (!gsub.hasScript("arab")) return undefined;

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

  glyphs = applyLigatures(glyphs, gsub, font, "arab", "rlig");
  return glyphs;
}

/**
 * Latin: no joining, only ligatures. Returns undefined when the font offers none, so a document that
 * asks for them but uses a font without them keeps the plain path and stays byte-identical.
 */
function shapeLatin(
  codePoints: readonly number[],
  font: ShapingFont,
  gsub: GsubTable,
  features: readonly string[],
): ShapedGlyph[] | undefined {
  if (!gsub.hasScript("latn")) return undefined;
  const wanted = features.filter((f) => gsub.lookups("latn", f).length > 0);
  if (wanted.length === 0) return undefined;
  const plain = codePoints.map((cp) => {
    const glyph = font.getGlyphIndex(cp);
    return { glyph, advance: font.getAdvanceWidth(glyph), codePoints: [cp] };
  });
  let shaped = plain;
  for (const feature of wanted) shaped = applyLigatures(shaped, gsub, font, "latn", feature);
  // Nothing merged: hand back undefined so the caller measures and draws the untouched run.
  return shaped.length === plain.length ? undefined : shaped;
}

/** Collapse ligatures, longest match first, carrying every component's code points along. */
function applyLigatures(
  glyphs: ShapedGlyph[],
  gsub: GsubTable,
  font: ShapingFont,
  script: string,
  feature: string,
): ShapedGlyph[] {
  const lookups = gsub.lookups(script, feature);
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

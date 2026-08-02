import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";

/**
 * Font FALLBACK: picking, per code point, the first family in a stack that can draw it.
 *
 * `Text({ font: ["Inter", "NotoSansCJK"] })` should just work for mixed-script text. Without this a
 * code point the first family lacks comes out as `.notdef` - the empty box.
 *
 * The output is a list of pieces, each in ONE family, which is exactly the shape a styled `span`
 * already has. So the fallback reuses the whole segment machinery - breaking, bidi, shaping and
 * drawing all handle per-piece fonts already - instead of adding a second one beside it.
 */

/** A stretch of text that one family can draw. */
export interface FontRun {
  text: string;
  fontFamily: string;
}

/**
 * Split `text` into runs by family. Returns `undefined` when there is nothing to split - no stack, or
 * the first family draws everything - so a document that never asks for a fallback keeps its old path.
 *
 * A code point that NO family in the stack can draw stays with the first one, which then draws its
 * `.notdef`. That is what a browser does too: the fallback chain ends, and the missing glyph shows.
 */
export function splitByFont(
  text: string,
  fontFamily: string,
  fallback: readonly string[],
  fontStyle: FontStyle,
  metrics: FontMetrics,
): FontRun[] | undefined {
  if (fallback.length === 0) return undefined;

  const familyFor = (codePoint: number): string => {
    if (metrics.hasGlyph(codePoint, fontFamily, fontStyle)) return fontFamily;
    for (const family of fallback) {
      if (metrics.hasGlyph(codePoint, family, fontStyle)) return family;
    }
    return fontFamily; // nobody has it - the first family shows the missing glyph
  };

  const runs: FontRun[] = [];
  let current = "";
  let currentFamily = fontFamily;

  for (const ch of text) {
    const family = familyFor(ch.codePointAt(0)!);
    if (current !== "" && family !== currentFamily) {
      runs.push({ text: current, fontFamily: currentFamily });
      current = "";
    }
    currentFamily = family;
    current += ch;
  }
  if (current !== "") runs.push({ text: current, fontFamily: currentFamily });

  // Nothing substituted - no runs at all (empty text), or one in the family we started with. Say so,
  // and the caller keeps its cheaper path instead of being handed an empty list to draw.
  const unchanged = runs.length === 0 || (runs.length === 1 && runs[0].fontFamily === fontFamily);
  return unchanged ? undefined : runs;
}

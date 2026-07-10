/**
 * How wide a run of text is: the horizontal counterpart to `line-metrics.ts` (how tall a line is)
 * and `line-breaker.ts` (where a line breaks). The ONE canonical answer to "how far does the pen
 * move", so measuring and drawing can never disagree about it.
 *
 * An advance has three parts, each with its own PDF mechanism:
 *
 *     advance = sum(glyph widths)  +  sum(kerning)  +  n * letterSpacing
 *                  /Widths             TJ array          Tc
 *
 * `letterSpacing` is added after EVERY code point, the last one included - exactly what the `Tc`
 * operator does, and exactly what CSS `letter-spacing` does (which is why right-aligned spaced text
 * looks a hair offset: a spacing hangs off the final glyph). Measuring `(n - 1)` spacings while `Tc`
 * applies `n` would make every line draw one spacing wider than it was wrapped - text out of its box.
 *
 * Kerning is added ONLY when the document has it on (`metrics.kerningEnabled`), and then the backend
 * emits a `TJ` with the same per-pair adjustments - so a measured advance always equals the drawn
 * one. With kerning off, `getStringWidth` is the whole advance (its plain glyph sum), byte-identical
 * to before. Folding kerning into the measurement while the output ignored it was the 2026-07-10 bug.
 */

import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";

/** The font a run is set in. */
export interface RunFont {
  fontFamily: string;
  fontSize: number;
  fontStyle: FontStyle;
}

/** Number of Unicode code points (not UTF-16 units): an astral char is ONE, so it takes one
 *  letter-spacing, not two. Matches how `getStringWidth` iterates. */
export function codePointCount(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** The advance of `text` in points: the plain glyph widths, plus kerning (if the document has it on),
 *  plus one `letterSpacing` per code point. */
export function runAdvance(
  metrics: FontMetrics,
  text: string,
  font: RunFont,
  letterSpacing = 0,
): number {
  let advance = metrics.getStringWidth(text, font.fontFamily, font.fontSize, font.fontStyle);
  if (letterSpacing !== 0) advance += codePointCount(text) * letterSpacing;
  if (metrics.kerningEnabled) {
    let units = 0;
    for (const k of metrics.getKernPairs(text, font.fontFamily, font.fontStyle)) units += k;
    advance += (units / 1000) * font.fontSize; // kern units are em/1000
  }
  return advance;
}

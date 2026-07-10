/**
 * How wide a run of text is: the horizontal counterpart to `line-metrics.ts` (how tall a line is)
 * and `line-breaker.ts` (where a line breaks). The ONE canonical answer to "how far does the pen
 * move", so measuring and drawing can never disagree about it.
 *
 * An advance has three parts, each with its own PDF mechanism. Only the first is wired up today:
 *
 *     advance = sum(glyph widths)  +  sum(kerning)  +  n * letterSpacing
 *                  /Widths             TJ array          Tc
 *
 * `letterSpacing` is added after EVERY code point, the last one included - exactly what the `Tc`
 * operator does, and exactly what CSS `letter-spacing` does (which is why right-aligned spaced text
 * looks a hair offset: a spacing hangs off the final glyph). Measuring `(n - 1)` spacings while `Tc`
 * applies `n` would make every line draw one spacing wider than it was wrapped - text out of its box.
 *
 * Kerning is deliberately absent: a run is written as a single `Tj`, which a viewer advances by the
 * plain widths. Folding kerning into the measurement while the output ignores it is the bug that was
 * removed on 2026-07-10. When we emit `TJ`, kerning joins here and in the backend in the same change.
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

/** The advance of `text` in points: the plain glyph widths plus one `letterSpacing` per code point. */
export function runAdvance(
  metrics: FontMetrics,
  text: string,
  font: RunFont,
  letterSpacing = 0,
): number {
  const glyphs = metrics.getStringWidth(text, font.fontFamily, font.fontSize, font.fontStyle);
  return letterSpacing === 0 ? glyphs : glyphs + codePointCount(text) * letterSpacing;
}

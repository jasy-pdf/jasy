/**
 * The vertical half of text layout: how tall a line box is, and where its baseline sits.
 *
 * One canonical answer, like `line-breaker.ts` is the one canonical answer for the horizontal
 * half. Measuring (`calculateTextHeight`), fragmenting (`TextElement.fragment`) and drawing
 * (`TextRenderer._buildRuns`) all call in here, so they can never disagree about a line's height
 * again - the divergence that produced ISSUE-5.
 */

import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import type { SegmentDefaults, SegmentLine } from "./line-breaker.ts";

/** A font's vertical metrics, as fractions of the em (so they scale by multiplying with fontSize). */
export interface FontVerticals {
  /** Distance from the baseline up to the ascender. Positive. */
  ascent: number;
  /** Distance from the baseline down to the descender. Positive (unlike the AFM/hhea sign). */
  descent: number;
  /** Extra leading the font asks for between two lines. Often 0 for a TrueType face. */
  lineGap: number;
}

/** One font used on a line: its metrics and the size it is set at. */
export interface LinePart {
  verticals: FontVerticals;
  fontSize: number;
}

/** A laid-out line box, in points, relative to the top of the box. */
export interface LineBox {
  /** Total height of the line box. Lines stack by this. */
  height: number;
  /** Distance from the top of the line box down to the baseline. */
  baseline: number;
}

/**
 * The line box for a set of fonts sharing one line.
 *
 * `lineHeight` is a multiplier of the font size, like CSS. Leave it `undefined` for the font's
 * NATURAL line height (`ascent + descent + lineGap`), which is what CSS calls `line-height: normal`.
 *
 * Whatever is left over between the box and the font's content is split evenly above and below
 * ("half-leading", as CSS and Flutter do), so the glyphs sit centred in their own box. An explicit
 * `lineHeight` smaller than the content makes the leading negative and the glyphs overflow - again
 * exactly like CSS, and the author asked for it.
 */
export function lineBoxFor(parts: LinePart[], lineHeight?: number): LineBox {
  if (parts.length === 0) return { height: 0, baseline: 0 };

  let ascent = 0;
  let descent = 0;
  let gap = 0;
  let maxFontSize = 0;
  for (const { verticals, fontSize } of parts) {
    ascent = Math.max(ascent, verticals.ascent * fontSize);
    descent = Math.max(descent, verticals.descent * fontSize);
    gap = Math.max(gap, verticals.lineGap * fontSize);
    maxFontSize = Math.max(maxFontSize, fontSize);
  }

  const content = ascent + descent;
  const height = lineHeight === undefined ? content + gap : maxFontSize * lineHeight;
  return { height, baseline: (height - content) / 2 + ascent };
}

/** The line box of a single-font line (the plain-string path). */
export function lineBoxForString(
  metrics: FontMetrics,
  fontFamily: string,
  fontStyle: FontStyle,
  fontSize: number,
  lineHeight?: number,
): LineBox {
  return lineBoxFor(
    [{ verticals: metrics.getFontVerticals(fontFamily, fontStyle), fontSize }],
    lineHeight,
  );
}

/** The line box of a mixed-font line: the tallest ascent and the deepest descent on it win, so a
 *  big or a deep-descending span pushes the whole line apart rather than colliding with it. */
export function lineBoxForSegmentLine(
  line: SegmentLine,
  defaults: SegmentDefaults,
  metrics: FontMetrics,
  lineHeight?: number,
): LineBox {
  const parts: LinePart[] = line.segments.map((segment) => {
    const fontFamily = segment.fontFamily ?? defaults.fontFamily;
    const fontStyle = segment.fontStyle ?? defaults.fontStyle;
    return {
      verticals: metrics.getFontVerticals(fontFamily, fontStyle),
      fontSize: segment.fontSize ?? defaults.fontSize,
    };
  });
  // A line with no segments still occupies its default font's box (an empty paragraph keeps height).
  if (parts.length === 0) {
    return lineBoxForString(
      metrics,
      defaults.fontFamily,
      defaults.fontStyle,
      defaults.fontSize,
      lineHeight,
    );
  }
  return lineBoxFor(parts, lineHeight);
}

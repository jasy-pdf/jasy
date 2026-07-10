/**
 * Where an underline and a strikethrough sit, and how thick they are.
 *
 * These are GLYPH metrics, and they are deliberately NOT part of `FontVerticals` in
 * `line-metrics.ts`, which holds LINE metrics. Confusing the two is exactly what produced ISSUE-5:
 * the AFM's `Ascender` (the height of a `b`) was used to seat a baseline, a job that belongs to the
 * `FontBBox`. Keep the two kinds of number in two places so they cannot be mixed up again.
 *
 * Every number here comes out of the font: the standard-14 AFM header, or a TrueType `post` +
 * `OS/2` table. Nothing is invented. Verified against `google-chrome --headless --print-to-pdf` on
 * the same font: Chrome's strikethrough centre lands on `xHeight / 2` (measured 0.260 em vs the
 * font's 0.262), and its underline stroke with `text-decoration-thickness: from-font` is the font's
 * `underlineThickness` (0.048 em vs 0.050). Chrome does NOT use the font's underline POSITION - it
 * has its own offset - so we follow the font there and land within 0.02 em of it.
 */

/** A font's decoration metrics, as fractions of the em. */
export interface FontDecoration {
  /** Distance BELOW the baseline to the CENTRE of the underline stroke. Positive.
   *  (The AFM defines it as "the distance from the baseline for centering underlining strokes";
   *  FreeType reads TrueType's `post.underlinePosition` the same way.) */
  underlinePosition: number;
  /** Stroke thickness, used by both the underline and the strikethrough. */
  underlineThickness: number;
  /** Height of a lowercase `x` above the baseline. Sets where a strikethrough crosses. */
  xHeight: number;
  /** Height of a capital above the baseline. */
  capHeight: number;
}

/** A decoration stroke: the y of its centre line, and how thick it is. Points, engine coords. */
export interface DecorationStroke {
  y: number;
  thickness: number;
}

/** The underline for a run whose baseline sits at `baselineY` (engine coords, y grows down). */
export function underlineStroke(
  decoration: FontDecoration,
  fontSize: number,
  baselineY: number,
): DecorationStroke {
  return {
    y: baselineY + decoration.underlinePosition * fontSize,
    thickness: decoration.underlineThickness * fontSize,
  };
}

/**
 * The strikethrough for a run whose baseline sits at `baselineY`. It crosses at half the x-height,
 * which is what a browser does and what looks right: through the middle of the lowercase letters,
 * not through the middle of the capitals.
 */
export function strikethroughStroke(
  decoration: FontDecoration,
  fontSize: number,
  baselineY: number,
): DecorationStroke {
  return {
    y: baselineY - (decoration.xHeight / 2) * fontSize,
    thickness: decoration.underlineThickness * fontSize,
  };
}

/**
 * Horizontal breathing room left on each side of a descender that interrupts an underline. Unlike
 * everything else in this file this is a DESIGN choice, not a number read from the font - so it is
 * expressed in the one quantity the font does give us, the stroke thickness.
 */
const SKIP_INK_PADDING = 1.0;

/**
 * Cuts `[0, runWidth]` at every place the glyphs put ink, leaving the segments an underline should
 * actually draw. `inkSpans` are x-intervals in points from the start of the run.
 *
 * This is CSS `text-decoration-skip-ink`, and it needs the real glyph outlines - so it only works
 * for an embedded font. Segments narrower than the padding are dropped: a sliver of a line between
 * two descenders reads as dirt, not as an underline.
 */
export function skipInkSegments(
  runWidth: number,
  inkSpans: Array<[number, number]>,
  thickness: number,
): Array<[number, number]> {
  const pad = SKIP_INK_PADDING * thickness;
  const segments: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of inkSpans) {
    const gapStart = Math.max(0, start - pad);
    const gapEnd = Math.min(runWidth, end + pad);
    if (gapStart > cursor + pad) segments.push([cursor, gapStart]);
    cursor = Math.max(cursor, gapEnd);
  }
  if (runWidth > cursor + pad) segments.push([cursor, runWidth]);
  return segments;
}

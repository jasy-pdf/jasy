import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import type { TextSegment } from "../elements/text-element.ts";
import { runAdvance } from "./advance.ts";

/**
 * How far a JUSTIFIED line's spaces may be squeezed to keep one more word on it.
 *
 * A quarter, because our breaker is GREEDY: it will use the whole allowance every time that saves a
 * line, so the limit has to be the tightest word space still worth reading - about three quarters of
 * natural, the usual typographic floor. TeX allows a third, but its badness model rarely spends it.
 * For reference, react-pdf reaches -19% in practice (measured: a 3.18pt space squeezed to 2.58pt),
 * which this covers. Its packing can still differ by a word, because it spreads the squeeze over the
 * CHARACTERS as well as the spaces.
 *
 * Only justified text uses it: under any other alignment a squeezed line would simply overflow.
 */
export const MAX_SPACE_SHRINK = 1 / 4;

/** Default font for segments that don't override it. */
export interface SegmentDefaults {
  fontFamily: string;
  fontSize: number;
  fontStyle: FontStyle;
  /** Extra space after every glyph, in points; a segment may override it. Default 0. */
  letterSpacing?: number;
}

/** What happens to text beyond `maxLines`: `"clip"` drops it, `"ellipsis"` ends the last kept line
 *  with an ellipsis. Mirrors Flutter's `TextOverflow`. */
export type TextOverflow = "clip" | "ellipsis";

/** Three ASCII dots, NOT the "…" glyph (U+2026): plain dots encode in every font - standard-14
 *  (WinAnsi) and any embedded TTF - whereas U+2026 needs a glyph the font may not carry. */
const ELLIPSIS = "...";

/** One laid-out line of segments. How TALL it is does not live here: the breaker owns the horizontal
 *  half, `text/line-metrics.ts` owns the vertical one and derives the box from the fonts on the line. */
export interface SegmentLine {
  segments: TextSegment[];
  width: number; // sum of word widths incl. spaces, used for alignment
}

/**
 * Break a plain string into lines that each fit within `maxWidth`, splitting on
 * spaces (greedy: a word stays on the current line unless it would overflow).
 *
 * Single source of truth for plain-string wrapping: both height measurement and
 * rendering call this, so they can never disagree. Depends only on `FontMetrics`,
 * not the PDF byte writer - the future fragmentation pass can reuse it.
 */
/**
 * The width of `text` set as ONE line, accumulated in EXACTLY the order `wrapStringIntoLines` builds a
 * line: the first word, then `+ (space + word)` each time. The order matters because floating-point
 * addition is not associative - a box sized by a differently-grouped sum can be one bit too small for
 * the very line the breaker then measures, and the text wraps inside a box made to fit it. That is not
 * hypothetical: it is what split a footer sized to its own content.
 */
export function singleLineWidth(
  text: string,
  font: { fontFamily: string; fontSize: number; fontStyle: FontStyle },
  metrics: FontMetrics,
  letterSpacing = 0,
): number {
  const space = runAdvance(metrics, " ", font, letterSpacing);
  return text
    .split(" ")
    .reduce(
      (width, word, i) =>
        i === 0
          ? runAdvance(metrics, word, font, letterSpacing)
          : width + (space + runAdvance(metrics, word, font, letterSpacing)),
      0,
    );
}

export function wrapStringIntoLines(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: FontStyle,
  maxWidth: number,
  metrics: FontMetrics,
  maxLines?: number,
  overflow?: TextOverflow,
  letterSpacing = 0,
  shrink = 0,
): string[] {
  let currentLine = "";
  let currentWidth = 0;
  let gaps = 0; // spaces on the current line, which is what a justified line can squeeze
  const lines: string[] = [];

  const font = { fontFamily, fontSize, fontStyle };
  const words = text.split(" ");
  words.forEach((word) => {
    // Word and space advances come from the one shared primitive (`advance.ts`), the same one
    // `naturalWidth` uses - so a bounded and an unbounded layout of the same text agree bit for bit.
    const wordWidth = runAdvance(metrics, word, font, letterSpacing);
    const spaceWidth = runAdvance(metrics, " ", font, letterSpacing);

    // Break before a word that won't fit - counting the SPACE that would join it, which the old test
    // forgot. It went unnoticed on the first line, where the very first word added a space too many
    // and cancelled the error out; after a break `currentWidth` is the bare word, so every following
    // test was short by one space and the line could overrun its box by that much.
    //
    // A single word wider than maxWidth still sits on its (empty) line and overflows, rather than
    // pushing a phantom empty line before it (which would over-count the height by a line).
    const candidate = currentWidth + (spaceWidth + wordWidth);

    if (currentLine === "") {
      currentLine = word;
      currentWidth = wordWidth;
      gaps = 0;
      // How much a JUSTIFIED line may be squeezed to keep one more word: the spaces already on the
      // line plus the one that would join it, each giving up at most `shrink` of its width. Zero for
      // every other alignment, where a squeezed line would simply overflow instead.
      // ONE expression, used for the test AND for the running total. Adding the same three numbers in
      // a different order gives a different last bit, and a line that lands exactly on `maxWidth` is
      // then broken by that bit alone - which is how a footer sized to its own text wrapped.
    } else if (candidate - (gaps + 1) * spaceWidth * shrink > maxWidth) {
      lines.push(currentLine.trim());
      currentLine = word;
      currentWidth = wordWidth;
      gaps = 0;
    } else {
      currentLine += " " + word;
      currentWidth = candidate;
      gaps += 1;
    }
  });

  if (currentLine) lines.push(currentLine.trim());

  // Open-end by default; cap only when maxLines is set (the others get undefined → untouched).
  if (maxLines == null || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  if (overflow === "ellipsis") {
    const last = kept.length - 1;
    kept[last] = ellipsize(
      kept[last],
      fontFamily,
      fontSize,
      fontStyle,
      maxWidth,
      metrics,
      letterSpacing,
    );
  }
  return kept;
}

/**
 * Break styled segments into lines that fit within `maxWidth`. Same greedy word-splitting as the
 * string breaker; each line keeps the segments that landed on it, which is what `line-metrics.ts`
 * later derives the line's height from. Single source of truth: both height measurement and
 * rendering call this.
 */
export function breakSegmentsIntoLines(
  segments: TextSegment[],
  defaults: SegmentDefaults,
  maxWidth: number,
  metrics: FontMetrics,
  maxLines?: number,
  overflow?: TextOverflow,
): SegmentLine[] {
  const lines: SegmentLine[] = [];
  let width = 0;
  let lineSegments: TextSegment[] = [];
  let combined = "";

  segments.forEach((segment) => {
    const family = segment.fontFamily || defaults.fontFamily;
    const size = segment.fontSize || defaults.fontSize;
    const style = segment.fontStyle || defaults.fontStyle;
    const letterSpacing = segment.letterSpacing ?? defaults.letterSpacing ?? 0;
    const font = { fontFamily: family, fontSize: size, fontStyle: style };
    const spaceWidth = runAdvance(metrics, " ", font, letterSpacing);
    const words = segment.content.split(" ");

    // Start this segment's piece empty; its content is filled word-by-word below. (Not
    // the original content - otherwise a segment whose FIRST word overflows would carry
    // its whole text into the line that just closed.)
    lineSegments.push({ ...segment, fontFamily: family, content: "" });
    combined = "";

    words.forEach((word, wordIndex) => {
      const wordWidth = runAdvance(metrics, word, font, letterSpacing);
      // A space joins this word to what precedes it only INSIDE a segment; segments butt together
      // with nothing between them, which is what `span("a") + span("b")` draws.
      const joiner = wordIndex > 0 ? spaceWidth : 0;
      // ONE expression for the test and for the running total, grouped exactly as `singleLineWidth`
      // groups it - see the note there. A width built any other way can be a bit off the one the box
      // was sized with, and the text wraps inside a box made to hold it.
      const candidate = width + (joiner + wordWidth);

      // Same guard as the string path: don't open a phantom empty line for an over-wide first word -
      // place it (overflowing) on the current empty line instead.
      if (candidate > maxWidth && width > 0) {
        lines.push({ segments: lineSegments, width });
        width = wordWidth;
        lineSegments = [];
        combined = word;
        lineSegments.push({ ...segment, content: combined });
      } else {
        combined += wordIndex === 0 ? word : " " + word;
        width = candidate;
        if (lineSegments.length === 0) {
          lineSegments.push({ ...segment, fontFamily: family, content: combined });
        }
        lineSegments[lineSegments.length - 1].content = combined;
      }
    });
  });

  if (lineSegments.length > 0) {
    lines.push({ segments: lineSegments, width });
  }

  // Open-end by default; cap only when maxLines is set.
  if (maxLines == null || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  if (overflow === "ellipsis")
    ellipsizeSegmentLine(kept[kept.length - 1], defaults, maxWidth, metrics);
  return kept;
}

/**
 * Inverse of `breakSegmentsIntoLines`: flatten broken lines back into a `TextSegment[]`
 * that re-wraps to exactly those lines. The wrap consumed the space at each line break,
 * so re-insert one between lines (unless the piece already ends with one) - otherwise the
 * last word of a line and the first of the next would fuse ("a b" + "c d" -> "a bc d").
 * Used by text fragmentation to rebuild the fitted/remainder halves of a split paragraph.
 */
export function segmentLinesToSegments(lines: SegmentLine[]): TextSegment[] {
  const result: TextSegment[] = [];
  lines.forEach((line, lineIndex) => {
    line.segments.forEach((segment) => result.push({ ...segment }));
    if (lineIndex < lines.length - 1) {
      const last = result[result.length - 1];
      if (last && !last.content.endsWith(" ")) last.content += " ";
    }
  });
  return result;
}

/** Appends "…" to a single line, dropping trailing words (then characters) until the line plus the
 *  ellipsis fits `maxWidth`. Falls back to a bare "…" if not even one character fits. */
function ellipsize(
  line: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: FontStyle,
  maxWidth: number,
  metrics: FontMetrics,
  letterSpacing = 0,
): string {
  const font = { fontFamily, fontSize, fontStyle };
  const fits = (s: string): boolean =>
    runAdvance(metrics, s + ELLIPSIS, font, letterSpacing) <= maxWidth;
  if (fits(line)) return line + ELLIPSIS;

  const words = line.split(" ");
  while (words.length > 1) {
    words.pop();
    if (fits(words.join(" "))) return words.join(" ") + ELLIPSIS;
  }
  // Drop one code point at a time (not one UTF-16 unit) so an astral char is never split into a
  // lone surrogate. `chars` is the code-point view; rebuild the string from its shrinking prefix.
  const chars = [...(words[0] ?? "")];
  while (chars.length > 1) {
    chars.pop();
    const single = chars.join("");
    if (fits(single)) return single + ELLIPSIS;
  }
  return ELLIPSIS;
}

/** Ellipsizes the LAST segment of a truncated segment line in place (within the width left by the
 *  segments before it) and recomputes the line width. */
function ellipsizeSegmentLine(
  line: SegmentLine,
  defaults: SegmentDefaults,
  maxWidth: number,
  metrics: FontMetrics,
): void {
  const segs = line.segments;
  if (segs.length === 0) return;
  const lsOf = (seg: TextSegment): number => seg.letterSpacing ?? defaults.letterSpacing ?? 0;
  const widthOf = (seg: TextSegment): number =>
    runAdvance(
      metrics,
      seg.content,
      {
        fontFamily: seg.fontFamily || defaults.fontFamily,
        fontSize: seg.fontSize || defaults.fontSize,
        fontStyle: seg.fontStyle || defaults.fontStyle,
      },
      lsOf(seg),
    );
  let prefix = 0;
  for (let i = 0; i < segs.length - 1; i++) prefix += widthOf(segs[i]);
  const last = segs[segs.length - 1];
  last.content = ellipsize(
    last.content,
    last.fontFamily || defaults.fontFamily,
    last.fontSize || defaults.fontSize,
    last.fontStyle || defaults.fontStyle,
    maxWidth - prefix,
    metrics,
    lsOf(last),
  );
  line.width = prefix + widthOf(last);
}

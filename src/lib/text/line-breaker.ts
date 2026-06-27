import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import type { TextSegment } from "../elements/text-element.ts";

/** Default font for segments that don't override it. */
export interface SegmentDefaults {
  fontFamily: string;
  fontSize: number;
  fontStyle: FontStyle;
}

/** What happens to text beyond `maxLines`: `"clip"` drops it, `"ellipsis"` ends the last kept line
 *  with an ellipsis. Mirrors Flutter's `TextOverflow`. */
export type TextOverflow = "clip" | "ellipsis";

/** Three ASCII dots, NOT the "…" glyph (U+2026): plain dots encode in every font - standard-14
 *  (WinAnsi) and any embedded TTF - whereas U+2026 needs a glyph the font may not carry. */
const ELLIPSIS = "...";

/** One laid-out line of segments. `maxFontSize` is the tallest font ON THIS LINE - its
 *  leading - matching how real engines (and this lib's plain-string path) space lines. */
export interface SegmentLine {
  segments: TextSegment[];
  width: number; // sum of word widths incl. spaces, used for alignment
  maxFontSize: number;
}

/**
 * Break a plain string into lines that each fit within `maxWidth`, splitting on
 * spaces (greedy: a word stays on the current line unless it would overflow).
 *
 * Single source of truth for plain-string wrapping: both height measurement and
 * rendering call this, so they can never disagree. Depends only on `FontMetrics`,
 * not the PDF byte writer - the future fragmentation pass can reuse it.
 */
export function wrapStringIntoLines(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: FontStyle,
  maxWidth: number,
  metrics: FontMetrics,
  maxLines?: number,
  overflow?: TextOverflow,
): string[] {
  let currentLine = "";
  let currentWidth = 0;
  const lines: string[] = [];

  const words = text.split(" ");
  words.forEach((word, index) => {
    const wordWidth = metrics.getStringWidth(word, fontFamily, fontSize, fontStyle);
    const spaceWidth = metrics.getCharWidth(" ", fontSize, undefined, fontFamily, fontStyle);

    // Break before a word that won't fit - but only once the line has content. A single word wider
    // than maxWidth must sit on its (empty) line and overflow, not push a phantom empty line before
    // it (which would over-count the height by a line and shift the text down at render).
    if (currentWidth + wordWidth > maxWidth && currentLine !== "") {
      lines.push(currentLine.trim());
      currentLine = word;
      currentWidth = wordWidth;
    } else {
      currentLine += index === 0 ? word : " " + word;
      currentWidth += wordWidth + spaceWidth;
    }
  });

  if (currentLine) lines.push(currentLine.trim());

  // Open-end by default; cap only when maxLines is set (the others get undefined → untouched).
  if (maxLines == null || lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  if (overflow === "ellipsis") {
    const last = kept.length - 1;
    kept[last] = ellipsize(kept[last], fontFamily, fontSize, fontStyle, maxWidth, metrics);
  }
  return kept;
}

/**
 * Break styled segments into lines that fit within `maxWidth`. Same greedy
 * word-splitting as the string breaker, but each line records the tallest font on
 * THAT line as its leading (per-line, not a paragraph-global maximum). Single source
 * of truth: both height measurement and rendering call this.
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
  let maxFontSize = 0; // per line: starts at 0, grows to the tallest font on the line
  let lineSegments: TextSegment[] = [];
  let combined = "";

  segments.forEach((segment) => {
    const family = segment.fontFamily || defaults.fontFamily;
    const size = segment.fontSize || defaults.fontSize;
    const style = segment.fontStyle || defaults.fontStyle;
    const spaceWidth = metrics.getCharWidth(" ", size, undefined, family, style);
    const words = segment.content.split(" ");

    // Start this segment's piece empty; its content is filled word-by-word below. (Not
    // the original content - otherwise a segment whose FIRST word overflows would carry
    // its whole text into the line that just closed.)
    lineSegments.push({ ...segment, fontFamily: family, content: "" });
    combined = "";
    if (maxFontSize < size) maxFontSize = size;

    words.forEach((word, wordIndex) => {
      const wordWidth = metrics.getStringWidth(word, family, size, style);

      // Same guard as the string path: don't open a phantom empty line for an over-wide first word -
      // place it (overflowing) on the current empty line instead.
      if (width + wordWidth > maxWidth && width > 0) {
        lines.push({ segments: lineSegments, width, maxFontSize });
        // Start the next line; its leading resets to the wrapping segment's size.
        width = 0;
        maxFontSize = size;
        lineSegments = [];
        combined = word;
        width += wordWidth + spaceWidth;
        lineSegments.push({ ...segment, content: combined });
      } else {
        combined += wordIndex === 0 ? word : " " + word;
        width += wordWidth + spaceWidth;
        if (lineSegments.length === 0) {
          lineSegments.push({ ...segment, fontFamily: family, content: combined });
        }
        lineSegments[lineSegments.length - 1].content = combined;
      }
    });
  });

  if (lineSegments.length > 0) {
    lines.push({ segments: lineSegments, width, maxFontSize });
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
): string {
  const fits = (s: string): boolean =>
    metrics.getStringWidth(s + ELLIPSIS, fontFamily, fontSize, fontStyle) <= maxWidth;
  if (fits(line)) return line + ELLIPSIS;

  const words = line.split(" ");
  while (words.length > 1) {
    words.pop();
    if (fits(words.join(" "))) return words.join(" ") + ELLIPSIS;
  }
  let single = words[0] ?? "";
  while (single.length > 1) {
    single = single.slice(0, -1);
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
  const widthOf = (seg: TextSegment): number =>
    metrics.getStringWidth(
      seg.content,
      seg.fontFamily || defaults.fontFamily,
      seg.fontSize || defaults.fontSize,
      seg.fontStyle || defaults.fontStyle,
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
  );
  line.width = prefix + widthOf(last);
}

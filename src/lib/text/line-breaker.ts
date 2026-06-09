import type { FontStyle } from "../utils/pdf-object-manager";
import type { FontMetrics } from "../utils/font-metrics";
import type { TextSegment } from "../elements/text-element";

/** Default font for segments that don't override it. */
export interface SegmentDefaults {
  fontFamily: string;
  fontSize: number;
  fontStyle: FontStyle;
}

/** One laid-out line of segments. `maxFontSize` is the tallest font ON THIS LINE — its
 *  leading — matching how real engines (and this lib's plain-string path) space lines. */
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
  metrics: FontMetrics
): string[] {
  let currentLine = "";
  let currentWidth = 0;
  const lines: string[] = [];

  const words = text.split(" ");
  words.forEach((word, index) => {
    const wordWidth = metrics.getStringWidth(
      word,
      fontFamily,
      fontSize,
      fontStyle
    );
    const spaceWidth = metrics.getCharWidth(
      " ",
      fontSize,
      undefined,
      fontFamily,
      fontStyle
    );

    if (currentWidth + wordWidth > maxWidth) {
      lines.push(currentLine.trim());
      currentLine = word;
      currentWidth = wordWidth;
    } else {
      currentLine += index === 0 ? word : " " + word;
      currentWidth += wordWidth + spaceWidth;
    }
  });

  if (currentLine) lines.push(currentLine.trim());

  return lines;
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
  metrics: FontMetrics
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

    lineSegments.push({ ...segment, fontFamily: family });
    combined = "";
    if (maxFontSize < size) maxFontSize = size;

    words.forEach((word, wordIndex) => {
      const wordWidth = metrics.getStringWidth(word, family, size, style);

      if (width + wordWidth > maxWidth) {
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

  return lines;
}

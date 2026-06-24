import { Color } from "../common/color.ts";
import { HorizontalAlignment } from "../elements/pdf-element.ts";
import { TextElement, TextSegment } from "../elements/text-element.ts";
import { FontStyle, PDFObjectManager } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import { IRNode, TextRun } from "../ir/display-list.ts";
import {
  wrapStringIntoLines,
  breakSegmentsIntoLines,
  SegmentLine,
  TextOverflow,
} from "../text/line-breaker.ts";

// Distance from the top of a line down to its baseline, as a fraction of the font
// size. ~0.683 is the standard-14 ascent ratio used to seat the first baseline.
const BASELINE_RATIO = 683 / 1000;

export class TextRenderer {
  // Measuring only needs metrics, not the full object manager. (The render pass below
  // still receives the manager because it also registers fonts/images.)
  public static calculateTextHeight(
    content: string | TextSegment[],
    fontSize: number,
    fontFamily: string,
    fontStyle: FontStyle,
    objectManager: FontMetrics,
    maxWidth: number,
    maxLines?: number,
    overflow?: TextOverflow,
    lineHeight = 1,
  ): number {
    // Plain string: one line box (fontSize * lineHeight) per wrapped line.
    if (typeof content === "string") {
      const lines = wrapStringIntoLines(
        content,
        fontFamily,
        fontSize,
        fontStyle,
        maxWidth,
        objectManager,
        maxLines,
        overflow,
      );
      return lines.length * fontSize * lineHeight;
    }

    // Segments: each line contributes its own (tallest-on-line) leading, scaled by lineHeight.
    const lines = breakSegmentsIntoLines(
      content,
      { fontFamily, fontSize, fontStyle },
      maxWidth,
      objectManager,
      maxLines,
      overflow,
    );
    return lines.reduce((total, line) => total + line.maxFontSize * lineHeight, 0);
  }

  static async render(
    textElement: TextElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const {
      x,
      y,
      width,
      fontSize,
      color,
      content,
      fontFamily,
      fontStyle,
      textAlignment,
      maxLines,
      overflow,
      lineHeight,
    } = textElement.getProps();

    // Component -> display list. Wrapping and positioning stay here; the backend
    // turns each run into BT/Tf/Td/Tj/ET. The wrapping algorithm is unchanged from
    // the original renderer - unifying it into the engine is Phase 3.
    return TextRenderer._buildRuns(
      content,
      fontSize,
      fontFamily,
      fontStyle,
      objectManager,
      width ?? Number.NaN,
      textAlignment,
      color,
      x,
      y,
      maxLines,
      overflow,
      lineHeight,
    );
  }

  // Lay the content out into absolutely-positioned text runs. Glyph positions match
  // the previous hand-written operators exactly (verified by pixel-identical render);
  // only the output form changed from PDF strings to `TextRun`s.
  private static _buildRuns(
    content: string | TextSegment[],
    fontSize: number,
    fontFamily: string,
    fontStyle: FontStyle,
    objectManager: PDFObjectManager,
    maxWidth: number,
    textAlignment: HorizontalAlignment,
    color: Color,
    initialX: number,
    yPosition: number,
    maxLines?: number,
    overflow?: TextOverflow,
    lineHeight = 1,
  ): TextRun[] {
    const runs: TextRun[] = [];

    // Horizontal offset of a line of the given width under the current alignment.
    const alignmentOffset = (lineWidth: number): number => {
      if (textAlignment === HorizontalAlignment.center) return (maxWidth - lineWidth) / 2;
      if (textAlignment === HorizontalAlignment.right) return maxWidth - lineWidth;
      return 0;
    };

    // Advance width WITHOUT kerning. This is how Tj moves the text cursor, so
    // segments flowing after each other land here. (Standard-14 fonts carry no
    // /Widths array; the viewer advances by the AFM widths - same source as below.)
    const advanceNoKerning = (
      text: string,
      family: string,
      size: number,
      style: FontStyle,
    ): number => {
      let width = 0;
      for (const ch of text) {
        width += objectManager.getCharWidth(ch, size, undefined, family, style);
      }
      return width;
    };

    // --- Plain string: one run per wrapped line. ---
    if (typeof content === "string") {
      const lines = wrapStringIntoLines(
        content,
        fontFamily,
        fontSize,
        fontStyle,
        maxWidth,
        objectManager,
        maxLines,
        overflow,
      );
      // yPosition is the top of the text box (top-left); seat line 0's baseline below it, then step
      // DOWN by one line box (fontSize * lineHeight) per line. The lineHeight EXTRA leading is split
      // half above / half below (CSS/Flutter "half-leading"), so the text sits centered in its line
      // box instead of clinging to the top. At lineHeight 1 the half-leading is 0 -> byte-identical.
      const halfLeading = (fontSize * (lineHeight - 1)) / 2;
      const baseline = yPosition + halfLeading + fontSize * BASELINE_RATIO;
      lines.forEach((line, index) => {
        const lineWidth = objectManager.getStringWidth(line, fontFamily, fontSize, fontStyle);
        runs.push({
          type: "text",
          x: initialX + alignmentOffset(lineWidth),
          y: baseline + fontSize * lineHeight * index,
          text: line,
          fontFamily,
          fontStyle,
          fontSize,
          color,
        });
      });
      return runs;
    }

    // --- Segments: break into lines (shared breaker), then emit one run per segment.
    // Segment 0 starts at the aligned line origin; each following segment is offset by
    // the previous segment's kerning-free advance. Each line drops by its OWN leading
    // (tallest font on that line), so mixed-font lines space correctly and the drawn
    // height matches the measured height.
    const pushLine = (line: SegmentLine, lineY: number): void => {
      let x = initialX + alignmentOffset(line.width);
      line.segments.forEach((segment) => {
        const family = segment.fontFamily || fontFamily;
        const size = segment.fontSize || fontSize;
        const style = segment.fontStyle || fontStyle;
        runs.push({
          type: "text",
          x,
          y: lineY,
          text: segment.content,
          fontFamily: family,
          fontStyle: style,
          fontSize: size,
          color: segment.fontColor || color,
        });
        x += advanceNoKerning(segment.content, family, size, style);
      });
    };

    // The overall tallest font seats the first baseline; each line then steps DOWN by
    // its own leading. yPosition is the top of the text box (top-left); the seam flips
    // the whole thing to PDF space.
    let overallMaxFont = fontSize;
    for (const segment of content) {
      const size = segment.fontSize || fontSize;
      if (size > overallMaxFont) overallMaxFont = size;
    }

    let lineY = yPosition + overallMaxFont * BASELINE_RATIO;
    for (const line of breakSegmentsIntoLines(
      content,
      { fontFamily, fontSize, fontStyle },
      maxWidth,
      objectManager,
      maxLines,
      overflow,
    )) {
      // Half-leading: shift this line's baseline down by half its own extra leading, so the line
      // sits centered in its box (CSS/Flutter). At lineHeight 1 the shift is 0 -> byte-identical.
      const halfLeading = (line.maxFontSize * (lineHeight - 1)) / 2;
      pushLine(line, lineY + halfLeading);
      lineY += line.maxFontSize * lineHeight;
    }

    return runs;
  }
}

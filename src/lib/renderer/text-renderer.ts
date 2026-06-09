import { Color } from "../common/color";
import { HorizontalAlignment } from "../elements/pdf-element";
import { TextElement, TextSegment } from "../elements/text-element";
import { FontStyle, PDFObjectManager } from "../utils/pdf-object-manager";
import { IRNode, TextRun } from "../ir/display-list";

export class TextRenderer {
  public static calculateTextHeight(
    content: string | TextSegment[],
    fontSize: number,
    fontFamily: string,
    fontStyle: FontStyle,
    objectManager: PDFObjectManager,
    maxWidth: number
  ): number {
    const calculateWrappedLineHeightForSegments = (
      textSegments: TextSegment[],
      maxWidth: number
    ): number => {
      let currentLineWidth = 0;
      let lineHeight = 0;
      let maxFontSizeinLine = 0;

      textSegments.forEach((segment) => {
        const _fontFamily = segment.fontFamily || fontFamily;
        const _fontSize = segment.fontSize || fontSize;
        const _fontStyle = segment.fontStyle || fontStyle;
        const spaceWidth = objectManager.getCharWidth(
          " ",
          _fontSize,
          undefined,
          _fontFamily,
          _fontStyle
        );
        if (maxFontSizeinLine < _fontSize) maxFontSizeinLine = _fontSize;

        // Split the segment content into words
        const words = segment.content.split(" ");

        words.forEach((word, _index) => {
          // Calculate the current string width by afm and its kernings
          const wordWidth = objectManager.getStringWidth(
            word,
            _fontFamily,
            _fontSize,
            _fontStyle
          );

          // Check if the current length is too big for the current line
          if (currentLineWidth + wordWidth > maxWidth) {
            lineHeight += maxFontSizeinLine;
            currentLineWidth = wordWidth; // Save all and create a new line
            maxFontSizeinLine = segment.fontSize || fontSize;
          } else {
            // No? Add the word to the current line
            currentLineWidth += wordWidth + spaceWidth;
          }
        });
      });

      // Is still text available, add the line height
      if (currentLineWidth > 0) {
        lineHeight += maxFontSizeinLine;
      }

      return lineHeight;
    };

    // This function adds line breaks if needed and returns the number of lines
    const calculateWrappedLineHeight = (
      text: string,
      fontFamily: string,
      fontSize: number,
      maxWidth: number
    ): number => {
      let currentLine = "";
      let currentWidth = 0;
      let lineHeight = 0;

      // Split the text into words, inclusive empty spaces
      const words = text.split(" ");

      words.forEach((word, index) => {
        // Calc the width of the actual word
        const wordWidth = objectManager.getStringWidth(
          word,
          fontFamily,
          fontSize,
          fontStyle
        );
        const spaceWidth = objectManager.getCharWidth(
          " ",
          fontSize,
          undefined,
          fontFamily,
          fontStyle
        );

        // Check if the word is too big for the current line
        if (currentWidth + wordWidth > maxWidth) {
          lineHeight += fontSize; // Add a line break
          currentLine = word;
          currentWidth = wordWidth;
        } else {
          // Add the word to the current line
          currentLine += index === 0 ? word : " " + word;
          currentWidth += wordWidth + spaceWidth; // Update the current line width
        }
      });

      // Add last line if not empty
      if (currentLine) {
        lineHeight += fontSize;
      }

      return lineHeight;
    };

    let totalLinesHeight = 0;

    // If content is a simple string
    if (typeof content === "string") {
      totalLinesHeight += calculateWrappedLineHeight(
        content,
        fontFamily,
        fontSize,
        maxWidth
      );
    }

    // If content is an array of `TextSegment`
    if (Array.isArray(content)) {
      totalLinesHeight = calculateWrappedLineHeightForSegments(
        content as TextSegment[],
        maxWidth
      );
    }

    // Return the total height based on the number of lines and font size
    return totalLinesHeight;
  }

  static async render(
    textElement: TextElement,
    objectManager: PDFObjectManager
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
      width || Number.NaN,
      textAlignment,
      color,
      x,
      y
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
    yPosition: number
  ): TextRun[] {
    const runs: TextRun[] = [];

    // Word-wrap a plain string by width (unchanged from the original).
    const wrapText = (
      text: string,
      fontFamily: string,
      fontSize: number,
      fontStyle: FontStyle,
      maxWidth: number
    ): string[] => {
      let currentLine = "";
      let currentWidth = 0;
      const lines: string[] = [];

      const words = text.split(" ");

      words.forEach((word, index) => {
        const wordWidth = objectManager.getStringWidth(
          word,
          fontFamily,
          fontSize,
          fontStyle
        );
        const spaceWidth = objectManager.getCharWidth(
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

      if (currentLine) {
        lines.push(currentLine.trim());
      }

      return lines;
    };

    // Horizontal offset of a line of the given width under the current alignment.
    const alignmentOffset = (lineWidth: number): number => {
      if (textAlignment === HorizontalAlignment.center)
        return (maxWidth - lineWidth) / 2;
      if (textAlignment === HorizontalAlignment.right)
        return maxWidth - lineWidth;
      return 0;
    };

    // Advance width WITHOUT kerning. This is how Tj moves the text cursor, so
    // segments flowing after each other land here. (Standard-14 fonts carry no
    // /Widths array; the viewer advances by the AFM widths - same source as below.)
    const advanceNoKerning = (
      text: string,
      family: string,
      size: number,
      style: FontStyle
    ): number => {
      let width = 0;
      for (const ch of text) {
        width += objectManager.getCharWidth(ch, size, undefined, family, style);
      }
      return width;
    };

    // --- Plain string: one run per wrapped line. ---
    if (typeof content === "string") {
      const lines = wrapText(content, fontFamily, fontSize, fontStyle, maxWidth);
      lines.forEach((line, index) => {
        const lineWidth = objectManager.getStringWidth(
          line,
          fontFamily,
          fontSize,
          fontStyle
        );
        runs.push({
          type: "text",
          x: initialX + alignmentOffset(lineWidth),
          y: yPosition - fontSize * index,
          text: line,
          fontFamily,
          fontStyle,
          fontSize,
          color,
        });
      });
      return runs;
    }

    // --- Segments: keep the original line-accumulation, emit one run per segment. ---
    // Emit the collected line as runs; segment 0 starts at the aligned line origin and
    // each following segment is offset by the previous segment's (kerning-free) advance.
    const pushLine = (
      lineSegments: { lineWidth: number; segments: TextSegment[] },
      lineY: number
    ): void => {
      let x = initialX + alignmentOffset(lineSegments.lineWidth);
      lineSegments.segments.forEach((segment) => {
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

    let currentLineWidth = 0;
    let maxFontSize = fontSize;
    let currentLineSegments: { lineWidth: number; segments: TextSegment[] } = {
      lineWidth: 0,
      segments: [],
    };
    let combinedSegment = "";

    content.forEach((segment) => {
      const _fontFamily = segment.fontFamily || fontFamily;
      const _fontSize = segment.fontSize || fontSize;
      const _fontStyle = segment.fontStyle || fontStyle;
      const words = segment.content.split(" ");

      const spaceWidth = objectManager.getCharWidth(
        " ",
        _fontSize,
        undefined,
        _fontFamily,
        _fontStyle
      );

      currentLineSegments.segments.push({ ...segment, fontFamily: _fontFamily });
      combinedSegment = "";

      if (maxFontSize < _fontSize) maxFontSize = _fontSize;

      words.forEach((word, wordIndex) => {
        const wordWidth = objectManager.getStringWidth(
          word,
          _fontFamily,
          _fontSize,
          _fontStyle
        );

        if (currentLineWidth + wordWidth > maxWidth) {
          currentLineSegments.lineWidth = currentLineWidth;
          pushLine(currentLineSegments, yPosition);

          // Advance to the next line. Leading is the line's max font size, matching
          // the original `yPosition -= maxFontSize`.
          yPosition -= maxFontSize;
          currentLineWidth = 0;
          currentLineSegments = { lineWidth: 0, segments: [] };
          combinedSegment = "";

          combinedSegment += word;
          currentLineWidth += wordWidth + spaceWidth;
          currentLineSegments.segments.push({
            ...segment,
            content: combinedSegment,
          });
        } else {
          combinedSegment += wordIndex === 0 ? word : " " + word;
          currentLineWidth += wordWidth + spaceWidth;
          if (currentLineSegments.segments.length === 0) {
            currentLineSegments.segments.push({
              ...segment,
              fontFamily: _fontFamily,
              content: combinedSegment,
            });
          }
          currentLineSegments.segments[
            currentLineSegments.segments.length - 1
          ].content = combinedSegment;
          currentLineSegments.lineWidth = currentLineWidth;
        }
      });
    });

    // Emit the last collected line.
    if (currentLineSegments.segments.length > 0) {
      currentLineSegments.lineWidth = currentLineWidth;
      pushLine(currentLineSegments, yPosition);
    }

    return runs;
  }
}

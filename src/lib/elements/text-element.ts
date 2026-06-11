import { Color } from "../common/color";
import { TextRenderer } from "../renderer";
import { FontStyle } from "../utils/pdf-object-manager";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import { Fragmentable, FragmentResult } from "../layout/fragmentation";
import {
  wrapStringIntoLines,
  breakSegmentsIntoLines,
  segmentLinesToSegments,
} from "../text/line-breaker";
import {
  HorizontalAlignment,
  LayoutContext,
  SizedPDFElement,
} from "./pdf-element";
export interface TextSegment {
  content: string;
  fontStyle?: FontStyle;
  fontColor?: Color;
  fontFamily?: string;
  fontSize?: number;
}

interface TextElementParams {
  id?: string;
  fontSize: number;
  fontFamily?: string;
  fontStyle?: FontStyle;
  content: string | TextSegment[];
  color?: Color; // optional param
  textAlignment?: HorizontalAlignment;
}

export class TextElement extends SizedPDFElement implements Fragmentable {
  private fontSize: number;
  private fontFamily: string;
  private fontStyle: FontStyle;
  private color: Color;
  private content: string | TextSegment[];
  private textAlignment: HorizontalAlignment;

  constructor({
    fontSize,
    content,
    fontFamily = "Helvetica",
    fontStyle = FontStyle.Normal,
    color = new Color(0, 0, 0),
    textAlignment = HorizontalAlignment.left,
  }: TextElementParams) {
    super({ x: 0, y: 0 });

    this.fontSize = fontSize;
    this.fontFamily = fontFamily;
    this.fontStyle = fontStyle;
    this.color = color;
    this.content = content;
    this.textAlignment = textAlignment;
  }

  /**
   * Splits the paragraph at line boxes (Slice 1). The lines that fit in `maxHeight` stay;
   * the rest become a remainder `TextElement` re-wrapped on the next page. If not even one
   * line fits, nothing is forced here - the caller (the container) decides whether to move
   * the whole element on for progress. Handles both plain strings and styled segments.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    return typeof this.content === "string"
      ? this.fragmentString(this.content, maxHeight, width, ctx)
      : this.fragmentSegments(this.content, maxHeight, width, ctx);
  }

  // Plain string: every wrapped line is `fontSize` tall (matches calculateTextHeight),
  // so `floor(maxHeight / fontSize)` lines fit.
  private fragmentString(
    content: string,
    maxHeight: number,
    width: number,
    ctx: LayoutContext
  ): FragmentResult {
    const lines = wrapStringIntoLines(
      content,
      this.fontFamily,
      this.fontSize,
      this.fontStyle,
      width,
      ctx.metrics
    );

    const fittedLineCount = Math.floor(maxHeight / this.fontSize);
    if (fittedLineCount <= 0) return { fitted: null, remainder: this };
    if (fittedLineCount >= lines.length)
      return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithContent(lines.slice(0, fittedLineCount).join(" ")),
      remainder: this.cloneWithContent(lines.slice(fittedLineCount).join(" ")),
    };
  }

  // Styled segments: each line's height is its tallest font (maxFontSize), so pack lines
  // by cumulative leading. Rebuild the fitted/remainder halves back into TextSegment[].
  private fragmentSegments(
    content: TextSegment[],
    maxHeight: number,
    width: number,
    ctx: LayoutContext
  ): FragmentResult {
    const lines = breakSegmentsIntoLines(
      content,
      {
        fontFamily: this.fontFamily,
        fontSize: this.fontSize,
        fontStyle: this.fontStyle,
      },
      width,
      ctx.metrics
    );

    let used = 0;
    let fittedLineCount = 0;
    for (const line of lines) {
      if (used + line.maxFontSize > maxHeight) break;
      used += line.maxFontSize;
      fittedLineCount++;
    }

    if (fittedLineCount <= 0) return { fitted: null, remainder: this };
    if (fittedLineCount >= lines.length)
      return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithContent(
        segmentLinesToSegments(lines.slice(0, fittedLineCount))
      ),
      remainder: this.cloneWithContent(
        segmentLinesToSegments(lines.slice(fittedLineCount))
      ),
    };
  }

  // A copy carrying the same style but different (already-wrapped) content. Re-wrapping at
  // the same width reproduces exactly those lines (greedy is deterministic).
  private cloneWithContent(content: string | TextSegment[]): TextElement {
    return new TextElement({
      content,
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
      fontStyle: this.fontStyle,
      color: this.color,
      textAlignment: this.textAlignment,
    });
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    this.x = offset.x;
    this.y = offset.y;
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;

    const wrapWidth = this.width ?? 0;
    this.height = TextRenderer.calculateTextHeight(
      this.content,
      this.fontSize,
      this.fontFamily,
      this.fontStyle,
      ctx.metrics,
      wrapWidth
    );

    // Top-left coordinates (y = top of the text box). The baseline offset and the
    // Y-flip are applied downstream (the line-builder positions baselines, the seam
    // flips to PDF), so the element stays coordinate-system-blind.
    return { width: wrapWidth, height: this.height };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
      fontStyle: this.fontStyle,
      color: this.color,
      content: this.content,
      textAlignment: this.textAlignment,
    };
  }
}

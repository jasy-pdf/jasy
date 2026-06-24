import { Color } from "../common/color.ts";
// Import the renderer DIRECTLY, not via the "../renderer" barrel: the barrel pulls in
// pdf-renderer (and every element) while this element module is still loading, which under
// ESM (Vite/vitest, and the future framework bindings) duplicates the element classes and
// breaks the constructor-keyed RendererRegistry. A direct import keeps the graph acyclic.
import { TextRenderer } from "../renderer/text-renderer.ts";
import { FontStyle } from "../utils/pdf-object-manager.ts";
import { DEFAULT_TEXT_STYLE, ResolvedTextStyle } from "../text/text-style.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";
import { Fragmentable, FragmentResult } from "../layout/fragmentation.ts";
import {
  wrapStringIntoLines,
  breakSegmentsIntoLines,
  segmentLinesToSegments,
  TextOverflow,
} from "../text/line-breaker.ts";
import { HorizontalAlignment, LayoutContext, SizedPDFElement } from "./pdf-element.ts";
export interface TextSegment {
  content: string;
  fontStyle?: FontStyle;
  fontColor?: Color;
  fontFamily?: string;
  fontSize?: number;
}

interface TextElementParams {
  id?: string;
  /** Unset (undefined) inherits the cascaded size; see ResolvedTextStyle. */
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: FontStyle;
  content: string | TextSegment[];
  color?: Color; // optional param
  textAlignment?: HorizontalAlignment;
  /** Cap the wrapped lines (default: unlimited / open-end). */
  maxLines?: number;
  /** What to do past `maxLines`: `"clip"` (default) drops them, `"ellipsis"` ends with "…". */
  overflow?: TextOverflow;
  /** Line-height multiplier: each line is `fontSize * lineHeight` tall (default `1`). */
  lineHeight?: number;
}

export class TextElement extends SizedPDFElement implements Fragmentable {
  // Author-set style; `undefined` means "inherit from the cascade". Kept so the style can be
  // re-resolved against whatever context lays the element out.
  private readonly rawFontSize?: number;
  private readonly rawFontFamily?: string;
  private readonly rawFontStyle?: FontStyle;
  private readonly rawColor?: Color;
  private readonly rawTextAlignment?: HorizontalAlignment;
  private readonly rawLineHeight?: number;

  // Resolved style (raw -> inherited -> built-in default). Seeded to the built-in default in the
  // constructor so the element is self-sufficient, then refined against the cascade at layout time.
  private fontSize!: number;
  private fontFamily!: string;
  private fontStyle!: FontStyle;
  private color!: Color;
  private textAlignment!: HorizontalAlignment;
  private lineHeight!: number;

  private content: string | TextSegment[];
  private maxLines?: number;
  private overflow: TextOverflow;

  constructor({
    fontSize,
    content,
    fontFamily,
    fontStyle,
    color,
    textAlignment,
    maxLines,
    overflow = "clip",
    lineHeight,
  }: TextElementParams) {
    super({ x: 0, y: 0 });

    this.rawFontSize = fontSize;
    this.rawFontFamily = fontFamily;
    this.rawFontStyle = fontStyle;
    this.rawColor = color;
    this.rawTextAlignment = textAlignment;
    this.rawLineHeight = lineHeight;
    this.content = content;
    this.maxLines = maxLines;
    this.overflow = overflow;
    this.applyStyle(DEFAULT_TEXT_STYLE);
  }

  // Resolve the author-set values against the cascade: explicit > inherited (ctx) > built-in default.
  private resolveStyle(ctx: LayoutContext): void {
    this.applyStyle(ctx.textStyle ?? DEFAULT_TEXT_STYLE);
  }

  private applyStyle(ts: ResolvedTextStyle): void {
    this.fontSize = this.rawFontSize ?? ts.fontSize;
    this.fontFamily = this.rawFontFamily ?? ts.fontFamily;
    this.fontStyle = this.rawFontStyle ?? ts.fontStyle;
    this.color = this.rawColor ?? ts.color;
    this.textAlignment = this.rawTextAlignment ?? ts.textAlignment;
    this.lineHeight = this.rawLineHeight ?? ts.lineHeight;
  }

  /**
   * Splits the paragraph at line boxes (Slice 1). The lines that fit in `maxHeight` stay;
   * the rest become a remainder `TextElement` re-wrapped on the next page. If not even one
   * line fits, nothing is forced here - the caller (the container) decides whether to move
   * the whole element on for progress. Handles both plain strings and styled segments.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    this.resolveStyle(ctx);
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
    ctx: LayoutContext,
  ): FragmentResult {
    const lines = wrapStringIntoLines(
      content,
      this.fontFamily,
      this.fontSize,
      this.fontStyle,
      width,
      ctx.metrics,
      this.maxLines,
      this.overflow,
    );

    const fittedLineCount = Math.floor(maxHeight / (this.fontSize * this.lineHeight));
    if (fittedLineCount <= 0) return { fitted: null, remainder: this };
    if (fittedLineCount >= lines.length) return { fitted: this, remainder: null };

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
    ctx: LayoutContext,
  ): FragmentResult {
    const lines = breakSegmentsIntoLines(
      content,
      {
        fontFamily: this.fontFamily,
        fontSize: this.fontSize,
        fontStyle: this.fontStyle,
      },
      width,
      ctx.metrics,
      this.maxLines,
      this.overflow,
    );

    let used = 0;
    let fittedLineCount = 0;
    for (const line of lines) {
      const lineBox = line.maxFontSize * this.lineHeight;
      if (used + lineBox > maxHeight) break;
      used += lineBox;
      fittedLineCount++;
    }

    if (fittedLineCount <= 0) return { fitted: null, remainder: this };
    if (fittedLineCount >= lines.length) return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithContent(segmentLinesToSegments(lines.slice(0, fittedLineCount))),
      remainder: this.cloneWithContent(segmentLinesToSegments(lines.slice(fittedLineCount))),
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
      maxLines: this.maxLines,
      overflow: this.overflow,
      lineHeight: this.lineHeight,
    });
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.resolveStyle(ctx);
    this.x = offset.x;
    this.y = offset.y;
    // Bounded width (e.g. inside a Column) wraps to that width; an unbounded width
    // (e.g. inside a Row) means the text takes its natural single-line width and does
    // not wrap. Columns always bound the width, so this leaves their layout untouched.
    this.width = constraints.hasBoundedWidth
      ? constraints.maxWidth
      : this.naturalWidth(ctx.metrics);

    const wrapWidth = this.width ?? 0;
    this.height = TextRenderer.calculateTextHeight(
      this.content,
      this.fontSize,
      this.fontFamily,
      this.fontStyle,
      ctx.metrics,
      wrapWidth,
      this.maxLines,
      this.overflow,
      this.lineHeight,
    );

    // Top-left coordinates (y = top of the text box). The baseline offset and the
    // Y-flip are applied downstream (the line-builder positions baselines, the seam
    // flips to PDF), so the element stays coordinate-system-blind.
    return { width: wrapWidth, height: this.height };
  }

  /** The unwrapped single-line width of the content (used when width is unbounded, e.g. inside a Row).
   *  Must match the LINE-BREAKER's one-line measure EXACTLY - not just algebraically but BIT-for-bit,
   *  so a text laid out at this width never re-wraps inside its own natural-width box. The breaker
   *  accumulates `currentWidth += wordWidth + spaceWidth`, grouping the word and its trailing space
   *  into one term; we must group the same way. Adding word and space as two separate steps is
   *  algebraically equal but, because floating-point addition is not associative, drifts by a sub-ULP
   *  - enough to tip a borderline string (e.g. "20 Jun 2026", wider than "04 Jul 2026" only because
   *  'n' beats 'l') one bit over its own width, dropping the last word onto a second line. */
  private naturalWidth(metrics: FontMetrics): number {
    const oneLine = (text: string, family: string, size: number, style: FontStyle): number => {
      const words = text.split(" ");
      const space = metrics.getCharWidth(" ", size, undefined, family, style);
      let width = 0;
      words.forEach((word, i) => {
        const w = metrics.getStringWidth(word, family, size, style);
        // Group (word + space) as one term, exactly like the breaker - see the note above.
        width += i < words.length - 1 ? w + space : w;
      });
      return width;
    };
    if (typeof this.content === "string") {
      return oneLine(this.content, this.fontFamily, this.fontSize, this.fontStyle);
    }
    return this.content.reduce(
      (sum, seg) =>
        sum +
        oneLine(
          seg.content,
          seg.fontFamily ?? this.fontFamily,
          seg.fontSize ?? this.fontSize,
          seg.fontStyle ?? this.fontStyle,
        ),
      0,
    );
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
      maxLines: this.maxLines,
      overflow: this.overflow,
      lineHeight: this.lineHeight,
    };
  }
}

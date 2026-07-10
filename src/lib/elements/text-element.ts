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
import { lineBoxForSegmentLine, lineBoxForString } from "../text/line-metrics.ts";
import { runAdvance } from "../text/advance.ts";
import { HorizontalAlignment, LayoutContext, SizedPDFElement } from "./pdf-element.ts";
export interface TextSegment {
  content: string;
  fontStyle?: FontStyle;
  fontColor?: Color;
  fontFamily?: string;
  fontSize?: number;
  /** External URL: this segment becomes an inline hyperlink (a /Link annotation over its glyphs). */
  href?: string;
  /** Internal named destination (an `Anchor`): this segment links to it (a /GoTo /Link annotation). */
  dest?: string;
  /** Unset inherits the Text's own setting; `true`/`false` overrides it for this run only. */
  underline?: boolean;
  strikethrough?: boolean;
  /** Extra space after every glyph, in points; unset inherits the Text's own value. */
  letterSpacing?: number;
}

/** Accessibility role for the tagged structure tree: a heading level or a paragraph (the default). */
export type TextRole = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p";

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
  /** Line-height multiplier: each line is `fontSize * lineHeight` tall. Unset means the font's
   *  natural line height (`ascent + descent + lineGap`), like CSS `line-height: normal`. */
  lineHeight?: number;
  /** Draw a line under the text, at the position and thickness the font declares. */
  underline?: boolean;
  /** Draw a line through the text, at half its x-height. */
  strikethrough?: boolean;
  /** Let the underline step around descenders. Needs an embedded font. */
  skipInk?: boolean;
  /** Extra space after every glyph, in points (CSS `letter-spacing`). Default 0. */
  letterSpacing?: number;
  /** Accessibility role for the tagged structure tree (heading level or paragraph; default `"p"`). */
  role?: TextRole;
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
  private readonly rawUnderline?: boolean;
  private readonly rawStrikethrough?: boolean;
  private readonly rawSkipInk?: boolean;
  private readonly rawLetterSpacing?: number;

  // Resolved style (raw -> inherited -> built-in default). Seeded to the built-in default in the
  // constructor so the element is self-sufficient, then refined against the cascade at layout time.
  private fontSize!: number;
  private fontFamily!: string;
  private fontStyle!: FontStyle;
  private color!: Color;
  private textAlignment!: HorizontalAlignment;
  private lineHeight?: number; // undefined = the font's natural line height
  private underline!: boolean;
  private strikethrough!: boolean;
  private skipInk!: boolean;
  private letterSpacing!: number;

  private content: string | TextSegment[];
  private maxLines?: number;
  private overflow: TextOverflow;
  private readonly role?: TextRole; // accessibility role (tagged PDF); undefined = paragraph

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
    underline,
    strikethrough,
    skipInk,
    letterSpacing,
    role,
  }: TextElementParams) {
    super({ x: 0, y: 0 });
    this.role = role;

    this.rawFontSize = fontSize;
    this.rawFontFamily = fontFamily;
    this.rawFontStyle = fontStyle;
    this.rawColor = color;
    this.rawTextAlignment = textAlignment;
    this.rawLineHeight = lineHeight;
    this.rawUnderline = underline;
    this.rawStrikethrough = strikethrough;
    this.rawSkipInk = skipInk;
    this.rawLetterSpacing = letterSpacing;
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
    this.underline = this.rawUnderline ?? ts.underline;
    this.strikethrough = this.rawStrikethrough ?? ts.strikethrough;
    this.skipInk = this.rawSkipInk ?? ts.skipInk;
    this.letterSpacing = this.rawLetterSpacing ?? ts.letterSpacing;
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

  // Plain string: every wrapped line gets the same box (the same one calculateTextHeight uses),
  // so `floor(maxHeight / lineBox)` lines fit.
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
      this.letterSpacing,
    );

    const box = lineBoxForString(
      ctx.metrics,
      this.fontFamily,
      this.fontStyle,
      this.fontSize,
      this.lineHeight,
    );
    const fittedLineCount = Math.floor(maxHeight / box.height);
    if (fittedLineCount <= 0) return { fitted: null, remainder: this };
    if (fittedLineCount >= lines.length) return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithContent(lines.slice(0, fittedLineCount).join(" ")),
      remainder: this.cloneWithContent(lines.slice(fittedLineCount).join(" ")),
    };
  }

  // Styled segments: each line's height comes from the fonts on it, so pack lines by cumulative
  // box height. Rebuild the fitted/remainder halves back into TextSegment[].
  private fragmentSegments(
    content: TextSegment[],
    maxHeight: number,
    width: number,
    ctx: LayoutContext,
  ): FragmentResult {
    const defaults = {
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontStyle: this.fontStyle,
      letterSpacing: this.letterSpacing,
    };
    const lines = breakSegmentsIntoLines(
      content,
      defaults,
      width,
      ctx.metrics,
      this.maxLines,
      this.overflow,
    );

    let used = 0;
    let fittedLineCount = 0;
    for (const line of lines) {
      const lineBox = lineBoxForSegmentLine(line, defaults, ctx.metrics, this.lineHeight).height;
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
      underline: this.underline,
      strikethrough: this.strikethrough,
      skipInk: this.skipInk,
      letterSpacing: this.letterSpacing,
      role: this.role,
    }).adoptStructId(this); // a wrapped remainder is the SAME logical paragraph (one P across pages)
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
      this.letterSpacing,
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
    const oneLine = (
      text: string,
      family: string,
      size: number,
      style: FontStyle,
      letterSpacing: number,
    ): number => {
      const font = { fontFamily: family, fontSize: size, fontStyle: style };
      const words = text.split(" ");
      const space = runAdvance(metrics, " ", font, letterSpacing);
      let width = 0;
      words.forEach((word, i) => {
        const w = runAdvance(metrics, word, font, letterSpacing);
        // Group (word + space) as one term, exactly like the breaker - see the note above. Both use
        // the same `runAdvance`, so the two agree bit for bit even with letterSpacing.
        width += i < words.length - 1 ? w + space : w;
      });
      return width;
    };
    if (typeof this.content === "string") {
      return oneLine(
        this.content,
        this.fontFamily,
        this.fontSize,
        this.fontStyle,
        this.letterSpacing,
      );
    }
    return this.content.reduce(
      (sum, seg) =>
        sum +
        oneLine(
          seg.content,
          seg.fontFamily ?? this.fontFamily,
          seg.fontSize ?? this.fontSize,
          seg.fontStyle ?? this.fontStyle,
          seg.letterSpacing ?? this.letterSpacing,
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
      underline: this.underline,
      strikethrough: this.strikethrough,
      skipInk: this.skipInk,
      letterSpacing: this.letterSpacing,
      role: this.role,
    };
  }
}

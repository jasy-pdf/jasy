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
import type { Direction } from "../text/bidi.ts";
import { applyTextTransform, type TextTransform } from "../text/text-style.ts";
import { splitByFont } from "../text/font-fallback.ts";
import { Fragmentable, FragmentResult } from "../layout/fragmentation.ts";
import {
  type LineOptions,
  singleLineWidth,
  MAX_SPACE_SHRINK,
  wrapStringIntoLines,
  breakSegmentsIntoLines,
  segmentLinesToSegments,
  TextOverflow,
} from "../text/line-breaker.ts";
import {
  adjustForOrphansWidows,
  DEFAULT_ORPHANS,
  DEFAULT_WIDOWS,
  type OrphanWidowRule,
} from "../text/orphans-widows.ts";
import { lineBoxForSegmentLine, lineBoxForString } from "../text/line-metrics.ts";
import { HorizontalAlignment, LayoutContext, SizedPDFElement } from "./pdf-element.ts";
import { normalizeContent } from "../text/whitespace.ts";
import { coverText } from "../text/glyph-coverage.ts";
import type { Hyphenator } from "../text/word-splitting.ts";
export interface TextSegment {
  content: string;
  fontStyle?: FontStyle;
  fontColor?: Color;
  fontFamily?: string;
  /** The rest of the family stack for THIS run; unset inherits the Text's own. */
  fontFallback?: string[];
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
  /**
   * CSS `vertical-align`, for a footnote marker or a formula index. Shifts THIS run's baseline;
   * it does not resize the text, and it does not change the line's height - set `fontSize` yourself
   * for the smaller look a browser's `<sup>` gets from its default stylesheet.
   */
  verticalAlign?: VerticalTextAlign;
}

/** How far a run sits off the baseline, as a fraction of its font size (up is positive). */
export const VERTICAL_TEXT_SHIFT: Record<VerticalTextAlign, number> = {
  baseline: 0,
  super: 1 / 3,
  sub: -1 / 5,
};

/** CSS `vertical-align`, the three values that mean something for a run of text. */
export type VerticalTextAlign = "baseline" | "super" | "sub";

/** Accessibility role for the tagged structure tree: a heading level or a paragraph (the default). */
export type TextRole = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p";

interface TextElementParams {
  id?: string;
  /** Unset (undefined) inherits the cascaded size; see ResolvedTextStyle. */
  fontSize?: number;
  fontFamily?: string;
  /** The rest of the family stack, for code points `fontFamily` cannot draw. */
  fontFallback?: string[];
  fontStyle?: FontStyle;
  content: string | TextSegment[];
  color?: Color; // optional param
  textAlignment?: HorizontalAlignment;
  /** Cap the wrapped lines (default: unlimited / open-end). */
  maxLines?: number;
  /** Minimum lines that must stay behind at a page break (CSS `orphans`, default 2). */
  orphans?: number;
  /** Minimum lines that must carry over to the next page (CSS `widows`, default 2). */
  widows?: number;
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
  /** Base writing direction (CSS `direction`); decides where a line starts. Default `"ltr"`. */
  direction?: Direction;
  /** CSS `text-transform`; applied before the text is measured or drawn. */
  textTransform?: TextTransform;
  /** CSS `word-spacing`, in points: extra advance at every space. */
  wordSpacing?: number;
  /** CSS `text-indent`, in points: how far the first line starts in. */
  textIndent?: number;
  /** CSS `overflow-wrap: break-word` - split a word wider than its box, anywhere. */
  breakWord?: boolean;
  /** Language-aware splitting; a hyphen is drawn at the break. See text/word-splitting.ts. */
  hyphenate?: Hyphenator;
  /** Accessibility role for the tagged structure tree (heading level or paragraph; default `"p"`). */
  role?: TextRole;
}

/**
 * A measurement in points has to be a real number. A NaN or an Infinity would travel all the way into
 * the content stream as a position - the backend refuses it there, but by then the message names a
 * coordinate rather than the property that was wrong. Rejected here, where the caller can see it.
 */
function finitePoints(value: number | undefined, name: string): number | undefined {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new Error(`@jasy/pdf: Invalid ${name} ${value}: it must be a finite number of points.`);
  }
  return value;
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
  private readonly rawDirection?: Direction;
  private readonly rawFontFallback?: string[];
  private readonly rawTextTransform?: TextTransform;
  private readonly rawWordSpacing?: number;
  private readonly rawTextIndent?: number;
  private readonly rawBreakWord?: boolean;
  private readonly rawHyphenate?: Hyphenator;

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
  private direction!: Direction;
  private fontFallback!: string[];
  // What the layout pass resolved the content to (transform applied, split by font). The render pass
  // has no metrics of its own, so it MUST read the same thing layout measured, not recompute it.
  private resolved?: string | TextSegment[];
  private textTransform!: TextTransform;
  private wordSpacing!: number;
  private textIndent!: number;
  private breakWord!: boolean;
  private hyphenate?: Hyphenator;

  private content: string | TextSegment[];
  private maxLines?: number;
  private orphans?: number;
  private widows?: number;
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
    orphans,
    widows,
    overflow = "clip",
    lineHeight,
    underline,
    strikethrough,
    skipInk,
    letterSpacing,
    direction,
    fontFallback,
    textTransform,
    wordSpacing,
    textIndent,
    breakWord,
    hyphenate,
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
    this.rawDirection = direction;
    this.rawFontFallback = fontFallback;
    this.rawTextTransform = textTransform;
    this.rawWordSpacing = finitePoints(wordSpacing, "wordSpacing");
    this.rawTextIndent = finitePoints(textIndent, "textIndent");
    this.rawBreakWord = breakWord;
    this.rawHyphenate = hyphenate;
    // Control characters have no glyph and would be DRAWN as .notdef boxes; `\n` survives
    // because the breaker treats it as a hard break. See text/whitespace.ts.
    this.content = normalizeContent(content);
    this.maxLines = maxLines;
    this.orphans = orphans;
    this.widows = widows;
    this.overflow = overflow;
    this.applyStyle(DEFAULT_TEXT_STYLE);
  }

  // Resolve the author-set values against the cascade: explicit > inherited (ctx) > built-in default.
  private resolveStyle(ctx: LayoutContext): void {
    this.applyStyle(ctx.textStyle ?? DEFAULT_TEXT_STYLE);
  }

  /** Justified lines may be squeezed to keep a word; every other alignment gets no slack. Read by the
   *  breaker in BOTH passes, or a measured line and a drawn one would disagree about where it ends. */
  /**
   * The content as it is measured AND drawn - `text-transform` applied. One place, so a recased
   * paragraph can never be measured in one casing and drawn in another (`ABC` and `abc` are not the
   * same width in most fonts).
   */
  private display(metrics?: FontMetrics): string | TextSegment[] {
    const cased = this.recased();
    // A SPAN may bring its own stack, so the element's being empty is not enough to skip the pass.
    const anyStack =
      this.fontFallback.length > 0 ||
      (typeof cased !== "string" && cased.some((seg) => (seg.fontFallback?.length ?? 0) > 0));
    if (!metrics) return cased;
    if (!anyStack) return this.covered(cased, metrics);
    // Font fallback turns the content into spans - one per family - which every later pass already
    // knows how to handle. Nothing new downstream.
    const pieces = typeof cased === "string" ? [{ content: cased } as TextSegment] : cased;
    const out: TextSegment[] = [];
    for (const seg of pieces) {
      const runs = splitByFont(
        seg.content,
        seg.fontFamily ?? this.fontFamily,
        seg.fontFallback ?? this.fontFallback,
        seg.fontStyle ?? this.fontStyle,
        metrics,
      );
      if (!runs) out.push(seg);
      else
        for (const run of runs) out.push({ ...seg, content: run.text, fontFamily: run.fontFamily });
    }
    return this.covered(out, metrics) as TextSegment[];
  }

  /**
   * Drops or substitutes whatever the RESOLVED font cannot draw. Runs last, after the fallback stack
   * has had its say, and before anything is measured - a character removed at draw time only would
   * make the measured line and the drawn one disagree. A font that draws everything gets its input
   * back unchanged, so an ordinary document is byte-identical.
   */
  private covered(content: string | TextSegment[], metrics: FontMetrics): string | TextSegment[] {
    const report = (dropped: number[]) => metrics.reportMissingGlyph?.(dropped);
    if (typeof content === "string") {
      const { text, dropped } = coverText(content, this.fontFamily, this.fontStyle, metrics);
      if (dropped.length > 0) report(dropped);
      return text;
    }
    return content.map((seg) => {
      const { text, dropped } = coverText(
        seg.content,
        seg.fontFamily ?? this.fontFamily,
        seg.fontStyle ?? this.fontStyle,
        metrics,
      );
      if (dropped.length > 0) report(dropped);
      return text === seg.content ? seg : { ...seg, content: text };
    });
  }

  /** The content with `text-transform` applied, and nothing else. */
  private recased(): string | TextSegment[] {
    if (this.textTransform === "none") return this.content;
    if (typeof this.content === "string") {
      return applyTextTransform(this.content, this.textTransform).text;
    }
    // The capitalisation state runs THROUGH the spans: `span("hel") + span("lo")` is one word.
    let atWordStart = true;
    return this.content.map((seg) => {
      const done = applyTextTransform(seg.content, this.textTransform, atWordStart);
      atWordStart = done.atWordStart;
      return { ...seg, content: done.text };
    });
  }

  private lineOptions(): LineOptions {
    return {
      wordSpacing: this.wordSpacing,
      indent: this.textIndent,
      splitting: { breakWord: this.breakWord, hyphenate: this.hyphenate },
      // Justified lines may be squeezed to keep a word; every other alignment gets no slack.
      shrink: this.textAlignment === HorizontalAlignment.justify ? MAX_SPACE_SHRINK : 0,
    };
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
    this.direction = this.rawDirection ?? ts.direction;
    this.fontFallback = this.rawFontFallback ?? ts.fontFallback;
    this.textTransform = this.rawTextTransform ?? ts.textTransform;
    this.wordSpacing = this.rawWordSpacing ?? ts.wordSpacing;
    this.textIndent = this.rawTextIndent ?? ts.textIndent;
    this.breakWord = this.rawBreakWord ?? ts.breakWord;
    this.hyphenate = this.rawHyphenate ?? ts.hyphenate;
  }

  /**
   * Splits the paragraph at line boxes (Slice 1). The lines that fit in `maxHeight` stay;
   * the rest become a remainder `TextElement` re-wrapped on the next page. If not even one
   * line fits, nothing is forced here - the caller (the container) decides whether to move
   * the whole element on for progress. Handles both plain strings and styled segments.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    this.resolveStyle(ctx);
    const content = this.display(ctx.metrics);
    return typeof content === "string"
      ? this.fragmentString(content, maxHeight, width, ctx)
      : this.fragmentSegments(content, maxHeight, width, ctx);
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
      this.lineOptions(),
    );

    const box = lineBoxForString(
      ctx.metrics,
      this.fontFamily,
      this.fontStyle,
      this.fontSize,
      this.lineHeight,
    );
    const fittedLineCount = adjustForOrphansWidows(
      Math.floor(maxHeight / box.height),
      lines.length,
      this.breakRule(),
    );
    if (fittedLineCount <= 0) return { fitted: null, remainder: this };
    if (fittedLineCount >= lines.length) return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithContent(lines.slice(0, fittedLineCount).join(" ")),
      // A continuation is no longer the paragraph's FIRST line, so it carries no indent.
      remainder: this.cloneWithContent(lines.slice(fittedLineCount).join(" "), 0),
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
      direction: this.direction,
      wordSpacing: this.wordSpacing,
      textIndent: this.textIndent,
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
    let packed = 0;
    for (const line of lines) {
      const lineBox = lineBoxForSegmentLine(line, defaults, ctx.metrics, this.lineHeight).height;
      if (used + lineBox > maxHeight) break;
      used += lineBox;
      packed++;
    }
    const fittedLineCount = adjustForOrphansWidows(packed, lines.length, this.breakRule());

    if (fittedLineCount <= 0) return { fitted: null, remainder: this };
    if (fittedLineCount >= lines.length) return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithContent(segmentLinesToSegments(lines.slice(0, fittedLineCount))),
      remainder: this.cloneWithContent(segmentLinesToSegments(lines.slice(fittedLineCount)), 0),
    };
  }

  /** The orphan/widow minimums for this paragraph; unset means the CSS default of 2 lines each. */
  private breakRule(): OrphanWidowRule {
    return {
      orphans: this.orphans ?? DEFAULT_ORPHANS,
      widows: this.widows ?? DEFAULT_WIDOWS,
    };
  }

  // A copy carrying the same style but different (already-wrapped) content. Re-wrapping at
  // the same width reproduces exactly those lines (greedy is deterministic).
  private cloneWithContent(content: string | TextSegment[], indent = this.textIndent): TextElement {
    return new TextElement({
      content,
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
      fontStyle: this.fontStyle,
      color: this.color,
      textAlignment: this.textAlignment,
      maxLines: this.maxLines,
      orphans: this.orphans,
      widows: this.widows,
      overflow: this.overflow,
      lineHeight: this.lineHeight,
      underline: this.underline,
      strikethrough: this.strikethrough,
      skipInk: this.skipInk,
      letterSpacing: this.letterSpacing,
      direction: this.direction,
      wordSpacing: this.wordSpacing,
      textIndent: indent,
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
    this.resolved = this.display(ctx.metrics);
    this.width = constraints.hasBoundedWidth
      ? constraints.maxWidth
      : this.naturalWidth(ctx.metrics);

    const wrapWidth = this.width ?? 0;
    this.height = TextRenderer.calculateTextHeight(
      this.resolved,
      this.fontSize,
      this.fontFamily,
      this.fontStyle,
      ctx.metrics,
      wrapWidth,
      this.maxLines,
      this.overflow,
      this.lineHeight,
      this.letterSpacing,
      this.lineOptions(),
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
    // The breaker's own sum, to the last bit - see `singleLineWidth`.
    const oneLine = (
      text: string,
      family: string,
      size: number,
      style: FontStyle,
      letterSpacing: number,
    ): number =>
      singleLineWidth(
        text,
        { fontFamily: family, fontSize: size, fontStyle: style },
        metrics,
        letterSpacing,
        this.wordSpacing,
      );
    // The FIRST line starts `textIndent` in, so an unbounded box has to be that much wider.
    const indent = Math.max(0, this.textIndent);
    const content = this.display(metrics);
    if (typeof content === "string") {
      return (
        indent +
        oneLine(content, this.fontFamily, this.fontSize, this.fontStyle, this.letterSpacing)
      );
    }
    return content.reduce(
      (sum, seg) =>
        sum +
        oneLine(
          seg.content,
          seg.fontFamily ?? this.fontFamily,
          seg.fontSize ?? this.fontSize,
          seg.fontStyle ?? this.fontStyle,
          seg.letterSpacing ?? this.letterSpacing,
        ),
      indent,
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
      content: this.resolved ?? this.content,
      textAlignment: this.textAlignment,
      maxLines: this.maxLines,
      orphans: this.orphans,
      widows: this.widows,
      overflow: this.overflow,
      lineHeight: this.lineHeight,
      underline: this.underline,
      strikethrough: this.strikethrough,
      skipInk: this.skipInk,
      letterSpacing: this.letterSpacing,
      direction: this.direction,
      wordSpacing: this.wordSpacing,
      textIndent: this.textIndent,
      breakWord: this.breakWord,
      hyphenate: this.hyphenate,
      role: this.role,
    };
  }
}

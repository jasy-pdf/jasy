import { TextElement, TextRole, TextSegment } from "../elements/text-element.ts";
import { HorizontalAlignment } from "../elements/pdf-element.ts";
import { FontStyle } from "../utils/pdf-object-manager.ts";
import { TextOverflow } from "../text/line-breaker.ts";
import { ResolvedTextStyle } from "../text/text-style.ts";
import { ColorInput, toColor } from "./color.ts";

export type { TextOverflow };

/** Text styling shared by `Text`, `Paragraph` and `span`. `bold`/`italic` are booleans
 *  (locked §7.3) and combine into one engine `FontStyle`. */
export interface TextStyle {
  size?: number;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  color?: ColorInput;
  /** Draw a line under the text. Its position and thickness come from the font, not from a guess.
   *  A `Link` is NOT underlined automatically - say so if you want it. */
  underline?: boolean;
  /** Draw a line through the text, at half its x-height (where a browser puts it). */
  strikethrough?: boolean;
  /** Let the underline step around descenders, like a browser (`text-decoration-skip-ink`). Needs an
   *  EMBEDDED font - the standard-14 outlines live in the viewer, so we cannot see where their ink
   *  is. Asking for it with a standard font is an error, not a silent no-op. */
  skipInk?: boolean;
  /** External URL - makes this run an inline hyperlink (a /Link annotation over its glyphs). On a
   *  `span` it links just that run; on a whole `Text` (plain string) it links the whole text. */
  href?: string;
  /** Internal jump target - the `name` of an `Anchor` elsewhere in the document (like `href`, but a
   *  same-document /GoTo instead of a URL). Use for a clickable table of contents / cross-reference. */
  to?: string;
}

export interface TextOptions extends TextStyle {
  /** Text-internal alignment (left/center/right) - independent of a parent's `cross` (§5). */
  align?: "left" | "center" | "right";
  /** Cap the number of wrapped lines (default: unlimited - the text grows down as far as it needs,
   *  paginating onto the next page). Needs a bounded width (a Column/Expanded/`Box({ width })`). */
  maxLines?: number;
  /** What happens past `maxLines`: `"clip"` (default) cuts hard, `"ellipsis"` ends with "…". */
  overflow?: TextOverflow;
  /** Line-height multiplier: each line is `size * lineHeight` tall. Unset means the font's own
   *  natural line height (`ascent + descent + lineGap`), like CSS `line-height: normal` - which is
   *  what you want for body copy. `1` gives exactly one em, which most faces overflow slightly. */
  lineHeight?: number;
  /** Accessibility role for the tagged structure tree (only when rendered with `accessible`): a heading
   *  level `"h1"`..`"h6"` or `"p"` (default). Purely semantic - it does not change the visual style. */
  role?: TextRole;
}

/** bold + italic → the single engine `FontStyle`. */
function toFontStyle(bold?: boolean, italic?: boolean): FontStyle {
  if (bold && italic) return FontStyle.BoldItalic;
  if (bold) return FontStyle.Bold;
  if (italic) return FontStyle.Italic;
  return FontStyle.Normal;
}

const ALIGN: Record<NonNullable<TextOptions["align"]>, HorizontalAlignment> = {
  left: HorizontalAlignment.left,
  center: HorizontalAlignment.center,
  right: HorizontalAlignment.right,
};

/**
 * Validates a font `size` (a number of points). Rejects anything that would silently become a NaN
 * height deep in layout - notably `Document({ size: "A4" })`, where `"A4"` is the PAGE size and belongs
 * on `Page`, not a font size. `undefined` passes through (unset = inherit the cascade).
 */
function toFontSize(size: unknown): number | undefined {
  if (size === undefined) return undefined;
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
    // Quote a string so "A4" reads as a string; show a bare number/NaN as-is (JSON turns NaN into null).
    const shown = typeof size === "string" ? JSON.stringify(size) : String(size);
    // The Page-vs-font-size mix-up only happens with a string like "A4"; for a plain bad number
    // (NaN, negative, 0) the hint would just be noise, so keep the message generic there.
    const hint =
      typeof size === "string"
        ? ` Note: the page size goes on Page({ size: "A4" }), not on Document or Text.`
        : "";
    throw new Error(`Invalid font size ${shown} (expected a positive number of points).${hint}`);
  }
  return size;
}

/**
 * An inline run for mixed-style `Text` (`Text([span("a", {bold:true}), span("b")])`). Each
 * field overrides the enclosing `Text`'s defaults for just this run; omitted fields inherit.
 */
export function span(text: string, style: TextStyle = {}): TextSegment {
  return {
    content: text,
    fontSize: toFontSize(style.size),
    fontFamily: style.font,
    fontStyle:
      style.bold !== undefined || style.italic !== undefined
        ? toFontStyle(style.bold, style.italic)
        : undefined,
    fontColor: style.color !== undefined ? toColor(style.color) : undefined,
    underline: style.underline,
    strikethrough: style.strikethrough,
    href: style.href,
    dest: style.to,
  };
}

/**
 * Text. `content` is a plain string or a list of `span(...)` runs for mixed styling. The
 * options set the defaults (size/font/style/color) that any spans inherit, plus the
 * text-internal `align`.
 */
export function Text(content: string | TextSegment[], opts: TextOptions = {}): TextElement {
  // A plain string given an `href`/`to` becomes a single link span, so `Text("jasy.dev", { href })` (or
  // `{ to }`) is a whole-text link (inline links use `span(...)`). This routes through the styled-segment
  // path, which lays a single default-font segment out identically - only the /Link annotation is added.
  const isLink = opts.href !== undefined || opts.to !== undefined;
  const body = typeof content === "string" && isLink ? [span(content, opts)] : content;
  // Unset properties are left undefined so they inherit the cascaded TextStyle (Document default /
  // built-in). Only bold/italic that the caller actually set become an explicit FontStyle.
  return new TextElement({
    content: body,
    fontSize: toFontSize(opts.size),
    fontFamily: opts.font,
    fontStyle:
      opts.bold !== undefined || opts.italic !== undefined
        ? toFontStyle(opts.bold, opts.italic)
        : undefined,
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    textAlignment: opts.align ? ALIGN[opts.align] : undefined,
    maxLines: opts.maxLines,
    overflow: opts.overflow,
    lineHeight: opts.lineHeight,
    underline: opts.underline,
    strikethrough: opts.strikethrough,
    skipInk: opts.skipInk,
    role: opts.role,
  });
}

/** `Text` with body-paragraph defaults (same options; a separate name reads as intent). */
export function Paragraph(content: string | TextSegment[], opts: TextOptions = {}): TextElement {
  return Text(content, opts);
}

/** The inheritable text defaults a `Document` can set, using the same option names as `Text`.
 *  Unset fields stay out so they keep inheriting. */
export interface TextDefaults {
  size?: number;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  color?: ColorInput;
  align?: "left" | "center" | "right";
  lineHeight?: number;
  underline?: boolean;
  strikethrough?: boolean;
  skipInk?: boolean;
}

/** Maps the `Text`-style option names onto a partial engine `ResolvedTextStyle` (only the set
 *  fields), for seeding the inheritance cascade. */
export function toTextStyleOverride(opts: TextDefaults): Partial<ResolvedTextStyle> {
  const style: Partial<ResolvedTextStyle> = {};
  if (opts.size !== undefined) style.fontSize = toFontSize(opts.size);
  if (opts.font !== undefined) style.fontFamily = opts.font;
  if (opts.bold !== undefined || opts.italic !== undefined) {
    style.fontStyle = toFontStyle(opts.bold, opts.italic);
  }
  if (opts.color !== undefined) style.color = toColor(opts.color);
  if (opts.align !== undefined) style.textAlignment = ALIGN[opts.align];
  if (opts.lineHeight !== undefined) style.lineHeight = opts.lineHeight;
  if (opts.underline !== undefined) style.underline = opts.underline;
  if (opts.strikethrough !== undefined) style.strikethrough = opts.strikethrough;
  if (opts.skipInk !== undefined) style.skipInk = opts.skipInk;
  return style;
}

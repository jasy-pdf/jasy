import { TextElement, TextSegment } from "../elements/text-element";
import { HorizontalAlignment } from "../elements/pdf-element";
import { FontStyle } from "../utils/pdf-object-manager";
import { TextOverflow } from "../text/line-breaker";
import { ResolvedTextStyle } from "../text/text-style";
import { ColorInput, toColor } from "./color";

export type { TextOverflow };

/** Text styling shared by `Text`, `Paragraph` and `span`. `bold`/`italic` are booleans
 *  (locked §7.3) and combine into one engine `FontStyle`. */
export interface TextStyle {
  size?: number;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  color?: ColorInput;
}

export interface TextOptions extends TextStyle {
  /** Text-internal alignment (left/center/right) - independent of a parent's `cross` (§5). */
  align?: "left" | "center" | "right";
  /** Cap the number of wrapped lines (default: unlimited - the text grows down as far as it needs,
   *  paginating onto the next page). Needs a bounded width (a Column/Expanded/`Box({ width })`). */
  maxLines?: number;
  /** What happens past `maxLines`: `"clip"` (default) cuts hard, `"ellipsis"` ends with "…". */
  overflow?: TextOverflow;
  /** Line-height multiplier (default `1`). `1.4` gives roomier body copy; each line is
   *  `size * lineHeight` tall. */
  lineHeight?: number;
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
 * An inline run for mixed-style `Text` (`Text([span("a", {bold:true}), span("b")])`). Each
 * field overrides the enclosing `Text`'s defaults for just this run; omitted fields inherit.
 */
export function span(text: string, style: TextStyle = {}): TextSegment {
  return {
    content: text,
    fontSize: style.size,
    fontFamily: style.font,
    fontStyle:
      style.bold !== undefined || style.italic !== undefined
        ? toFontStyle(style.bold, style.italic)
        : undefined,
    fontColor: style.color !== undefined ? toColor(style.color) : undefined,
  };
}

/**
 * Text. `content` is a plain string or a list of `span(...)` runs for mixed styling. The
 * options set the defaults (size/font/style/color) that any spans inherit, plus the
 * text-internal `align`.
 */
export function Text(content: string | TextSegment[], opts: TextOptions = {}): TextElement {
  // Unset properties are left undefined so they inherit the cascaded TextStyle (Document default /
  // built-in). Only bold/italic that the caller actually set become an explicit FontStyle.
  return new TextElement({
    content,
    fontSize: opts.size,
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
}

/** Maps the `Text`-style option names onto a partial engine `ResolvedTextStyle` (only the set
 *  fields), for seeding the inheritance cascade. */
export function toTextStyleOverride(opts: TextDefaults): Partial<ResolvedTextStyle> {
  const style: Partial<ResolvedTextStyle> = {};
  if (opts.size !== undefined) style.fontSize = opts.size;
  if (opts.font !== undefined) style.fontFamily = opts.font;
  if (opts.bold !== undefined || opts.italic !== undefined) {
    style.fontStyle = toFontStyle(opts.bold, opts.italic);
  }
  if (opts.color !== undefined) style.color = toColor(opts.color);
  if (opts.align !== undefined) style.textAlignment = ALIGN[opts.align];
  if (opts.lineHeight !== undefined) style.lineHeight = opts.lineHeight;
  return style;
}

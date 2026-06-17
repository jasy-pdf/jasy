import { TextElement, TextSegment } from "../elements/text-element";
import { HorizontalAlignment } from "../elements/pdf-element";
import { FontStyle } from "../utils/pdf-object-manager";
import { ColorInput, toColor } from "./color";

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
}

/** Body-text default size when none is given (matches the engine default font). */
const DEFAULT_SIZE = 12;

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
  return new TextElement({
    content,
    fontSize: opts.size ?? DEFAULT_SIZE,
    fontFamily: opts.font,
    fontStyle: toFontStyle(opts.bold, opts.italic),
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    textAlignment: opts.align ? ALIGN[opts.align] : undefined,
  });
}

/** `Text` with body-paragraph defaults (same options; a separate name reads as intent). */
export function Paragraph(content: string | TextSegment[], opts: TextOptions = {}): TextElement {
  return Text(content, opts);
}

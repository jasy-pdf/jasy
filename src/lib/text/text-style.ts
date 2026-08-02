import { Color } from "../common/color.ts";
import { FontStyle } from "../utils/pdf-object-manager.ts";
import { HorizontalAlignment } from "../elements/pdf-element.ts";
import type { Direction } from "./bidi.ts";

/** CSS `text-transform`. `capitalize` upper-cases the first letter of every word, as CSS does. */
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

/** Apply a `text-transform`. One place, so the measured text and the drawn text are the same string. */
export function applyTextTransform(text: string, transform: TextTransform): string {
  if (transform === "none") return text;
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  // CSS capitalises the first letter of every WORD and leaves the rest as written.
  return text.replace(
    /(^|\s)(\S)/gu,
    (_, lead: string, first: string) => lead + first.toUpperCase(),
  );
}

/**
 * The inheritable text properties - the same set CSS and Flutter cascade. A `Text` resolves each of
 * its own (possibly unset) properties against the nearest cascaded style: explicit > inherited >
 * built-in default. Box/layout properties (padding, border, width, ...) are deliberately NOT here -
 * they never inherit, exactly as in CSS.
 */
export interface ResolvedTextStyle {
  fontSize: number;
  fontFamily: string;
  fontStyle: FontStyle;
  color: Color;
  textAlignment: HorizontalAlignment;
  /** Multiplier of the font size. `undefined` means the font's natural line height
   *  (`ascent + descent + lineGap`), i.e. CSS `line-height: normal`. */
  lineHeight?: number;
  /** Draw a line under the text, at the position and thickness the font declares. */
  underline: boolean;
  /** Draw a line through the text, at half its x-height. */
  strikethrough: boolean;
  /** Let the underline step around descenders (CSS `text-decoration-skip-ink`). Needs an EMBEDDED
   *  font: the standard-14 outlines live in the viewer, not in the AFM. */
  skipInk: boolean;
  /** Extra space after every glyph, in points (CSS `letter-spacing`). Default 0. */
  letterSpacing: number;
  /** Base writing direction (CSS `direction`). It decides where a line STARTS and how neutral
   *  characters between two scripts resolve; the reordering itself follows Unicode UAX #9 either
   *  way, so Hebrew inside an `ltr` paragraph still comes out right. */
  direction: Direction;
  /** CSS `text-transform`: recase the text before it is measured or drawn. */
  textTransform: TextTransform;
  /** CSS `word-spacing`, in points: extra advance at every space. Negative tightens. */
  wordSpacing: number;
  /** CSS `text-indent`, in points: how far the FIRST line of a paragraph starts in. */
  textIndent: number;
}

/**
 * The root of the cascade: what a `Text` falls back to when neither it nor any ancestor sets a
 * property.
 */
export const DEFAULT_TEXT_STYLE: ResolvedTextStyle = {
  fontSize: 12,
  fontFamily: "Helvetica",
  fontStyle: FontStyle.Normal,
  color: new Color(0, 0, 0),
  textAlignment: HorizontalAlignment.start,
  lineHeight: undefined,
  underline: false,
  strikethrough: false,
  skipInk: false,
  letterSpacing: 0,
  direction: "ltr",
  textTransform: "none",
  wordSpacing: 0,
  textIndent: 0,
};

/** Layers a partial override onto a complete style; an unset (undefined) field keeps the base. */
export function mergeTextStyle(
  base: ResolvedTextStyle,
  override?: Partial<ResolvedTextStyle>,
): ResolvedTextStyle {
  if (!override) return base;
  return {
    fontSize: override.fontSize ?? base.fontSize,
    fontFamily: override.fontFamily ?? base.fontFamily,
    fontStyle: override.fontStyle ?? base.fontStyle,
    color: override.color ?? base.color,
    textAlignment: override.textAlignment ?? base.textAlignment,
    lineHeight: override.lineHeight ?? base.lineHeight,
    underline: override.underline ?? base.underline,
    strikethrough: override.strikethrough ?? base.strikethrough,
    skipInk: override.skipInk ?? base.skipInk,
    letterSpacing: override.letterSpacing ?? base.letterSpacing,
    direction: override.direction ?? base.direction,
    textTransform: override.textTransform ?? base.textTransform,
    wordSpacing: override.wordSpacing ?? base.wordSpacing,
    textIndent: override.textIndent ?? base.textIndent,
  };
}

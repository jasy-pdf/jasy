import { Color } from "../common/color.ts";
import { FontStyle } from "../utils/pdf-object-manager.ts";
import { HorizontalAlignment } from "../elements/pdf-element.ts";

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
  textAlignment: HorizontalAlignment.left,
  lineHeight: undefined,
  underline: false,
  strikethrough: false,
  skipInk: false,
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
  };
}

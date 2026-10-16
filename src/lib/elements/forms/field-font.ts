import type { LayoutContext } from "../pdf-element.ts";
import type { FontStyle } from "../../utils/pdf-object-manager.ts";
import { DEFAULT_TEXT_STYLE } from "../../text/text-style.ts";

/** The font a field's text inherits, like any text: `Document({ font })` or a `DefaultTextStyle`. */
export interface FieldFont {
  family: string;
  style: FontStyle;
}

export function inheritedFieldFont(ctx: LayoutContext): FieldFont {
  const ts = ctx.textStyle ?? DEFAULT_TEXT_STYLE;
  return { family: ts.fontFamily, style: ts.fontStyle };
}

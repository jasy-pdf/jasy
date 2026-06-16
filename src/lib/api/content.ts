import { LineElement } from "../elements/line-element";
import { PaddingElement } from "../elements/layout/padding-element";
import { PDFElement } from "../elements/pdf-element";
import { ColorInput, toColor } from "./color";
import { Insets, toEdges } from "./insets";

/** A horizontal rule (locked §4). */
export interface DividerOptions {
  /** Line colour (default a light grey). */
  color?: ColorInput;
  /** Line thickness in points (default 1). */
  thickness?: number;
  /** Space above/below the rule (default a small vertical gap). */
  margin?: Insets;
}

const DEFAULT_DIVIDER_COLOR: ColorInput = "lightgray";
const DEFAULT_DIVIDER_MARGIN: Insets = { y: 6 };

/**
 * A horizontal rule that spans the parent's width. Maps to a `LineElement` (hiding its
 * `xEnd`/`yEnd` mechanics) wrapped in a `PaddingElement` - the line has no height of its
 * own, so the padding gives it vertical room and centres the rule. Use inside a Column.
 */
export function Divider(opts: DividerOptions = {}): PDFElement {
  const line = new LineElement({
    x: 0,
    y: 0,
    xEnd: 0, // resolved to the parent's width at layout time
    yEnd: 0, // horizontal: no vertical span
    color: toColor(opts.color ?? DEFAULT_DIVIDER_COLOR),
    strokeWidth: opts.thickness ?? 1,
  });
  return new PaddingElement({
    margin: toEdges(opts.margin ?? DEFAULT_DIVIDER_MARGIN),
    child: line,
  });
}

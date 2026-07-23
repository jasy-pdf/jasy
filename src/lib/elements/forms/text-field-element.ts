import { Color } from "../../common/color.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "../pdf-element.ts";
import type { FieldStyle, TextFieldSpec } from "../../forms/field.ts";

export interface TextFieldParams {
  /** The field name (/T) - unique in the document; you read the value back by it. */
  name: string;
  /** Initial value (/V). */
  value?: string;
  /** Tooltip / accessible name (/TU). */
  tooltip?: string;
  /** Wrap across lines instead of one line. */
  multiline?: boolean;
  /** Mask the input. */
  password?: boolean;
  /** Maximum character count. */
  maxLength?: number;
  /** Show but do not allow editing. */
  readOnly?: boolean;
  /** Box width in points; omit to fill the offered width. */
  width?: number;
  /** Box height in points; omit for a single-line default (`multiline` wants an explicit height). */
  height?: number;
  /** Value font size; `0` = viewer auto-size. */
  fontSize?: number;
  /** Value text colour. */
  color?: Color;
  /** Box border colour (omit for no border). */
  border?: Color;
  /** Box background fill (omit for transparent). */
  background?: Color;
  /** Border thickness in points. */
  borderWidth?: number;
}

/**
 * A text input field (AcroForm /Tx). A leaf that draws NOTHING itself: it reserves its box in the layout
 * and emits a `formfield` IR node that becomes a Widget annotation + /AcroForm field at the seam.
 */
export class TextFieldElement extends SizedPDFElement {
  private spec: TextFieldSpec;
  private style: FieldStyle;
  private requested: { width?: number; height?: number; fontSize: number };

  constructor(p: TextFieldParams) {
    super({ x: 0, y: 0, width: p.width, height: p.height });
    const fontSize = p.fontSize ?? 12;
    this.spec = {
      kind: "text",
      name: p.name,
      value: p.value,
      tooltip: p.tooltip,
      multiline: p.multiline,
      password: p.password,
      maxLength: p.maxLength,
      readOnly: p.readOnly,
    };
    this.style = {
      border: p.border,
      background: p.background,
      color: p.color ?? new Color(0, 0, 0),
      fontSize,
      borderWidth: p.borderWidth ?? 1,
    };
    this.requested = { width: p.width, height: p.height, fontSize };
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    // Width: explicit, else fill the offered box (a form field with no width spans the column).
    this.width = this.requested.width ?? (constraints.hasBoundedWidth ? constraints.maxWidth : 200);
    // Height: explicit, else a comfortable single line (font size + padding). Multiline without an
    // explicit height still gets the single-line default - the caller should size a multiline box.
    this.height = this.requested.height ?? this.requested.fontSize + 9;
    return { width: this.width, height: this.height };
  }

  getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width ?? 0,
      height: this.height ?? 0,
      spec: this.spec,
      style: this.style,
    };
  }
}

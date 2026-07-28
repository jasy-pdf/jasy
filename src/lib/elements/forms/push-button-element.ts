import { Color } from "../../common/color.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "../pdf-element.ts";
import type { ButtonAction, FieldStyle, PushButtonSpec } from "../../forms/field.ts";

export interface PushButtonParams {
  /** The field name (/T) - unique in the document. */
  name: string;
  /** The caption drawn on the button. */
  label: string;
  /** What clicking it does; omit for a button that does nothing. */
  action?: ButtonAction;
  /** Tooltip / accessible name. */
  tooltip?: string;
  /** Draw it but do not let it be clicked. */
  readOnly?: boolean;
  /** Button width in points; omit to fill the offered width. */
  width?: number;
  /** Button height in points; omit for a comfortable default. */
  height?: number;
  /** Caption font size (default 12). */
  fontSize?: number;
  /** Caption colour (default black). */
  color?: Color;
  /** Border colour (default a mid grey). */
  border?: Color;
  /** Button face fill (default a light grey, so it reads as a button). */
  background?: Color;
  /** Border thickness (default 1). */
  borderWidth?: number;
}

/**
 * A push button (AcroForm /Btn, Pushbutton flag). Holds no value - it fires an action. Draws nothing
 * itself: it reserves its box and emits a `formfield` IR node whose caption is baked into an /AP at the
 * seam, so the button looks identical in every viewer and in print.
 */
export class PushButtonElement extends SizedPDFElement {
  private spec: PushButtonSpec;
  private style: FieldStyle;
  private requested: { width?: number; height?: number; fontSize: number };

  constructor(p: PushButtonParams) {
    super({ x: 0, y: 0, width: p.width, height: p.height });
    const fontSize = p.fontSize ?? 12;
    this.spec = {
      kind: "pushbutton",
      name: p.name,
      label: p.label,
      action: p.action,
      tooltip: p.tooltip,
      readOnly: p.readOnly,
    };
    this.style = {
      border: p.border ?? new Color(154, 164, 178),
      background: p.background ?? new Color(238, 240, 245),
      color: p.color ?? new Color(0, 0, 0),
      fontSize,
      borderWidth: p.borderWidth ?? 1,
    };
    this.requested = { width: p.width, height: p.height, fontSize };
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    this.width = this.requested.width ?? (constraints.hasBoundedWidth ? constraints.maxWidth : 120);
    this.height = this.requested.height ?? this.requested.fontSize + 14;
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

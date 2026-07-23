import { Color } from "../../common/color.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "../pdf-element.ts";
import type { CheckboxSpec, FieldStyle } from "../../forms/field.ts";

export interface CheckboxParams {
  /** The field name (/T) - unique in the document. */
  name: string;
  /** Whether it starts checked. */
  checked?: boolean;
  /** The "on" export value (default `"Yes"`). */
  onValue?: string;
  /** Tooltip / accessible name. */
  tooltip?: string;
  /** Show but do not allow toggling. */
  readOnly?: boolean;
  /** Box side length in points (default 14). */
  size?: number;
  /** Checkmark colour (default black). */
  color?: Color;
  /** Box border colour (default a mid grey, so the box is visible). */
  border?: Color;
  /** Box background fill. */
  background?: Color;
  /** Border thickness (default 1). */
  borderWidth?: number;
}

/**
 * A checkbox (AcroForm /Btn). A small square leaf that draws nothing itself: it reserves its box and
 * emits a `formfield` IR node whose checkbox spec bakes an /AP checkmark at the seam.
 */
export class CheckboxElement extends SizedPDFElement {
  private spec: CheckboxSpec;
  private style: FieldStyle;
  private size: number;

  constructor(p: CheckboxParams) {
    const size = p.size ?? 14;
    super({ x: 0, y: 0, width: size, height: size });
    this.size = size;
    this.spec = {
      kind: "checkbox",
      name: p.name,
      checked: p.checked,
      onValue: p.onValue,
      tooltip: p.tooltip,
      readOnly: p.readOnly,
    };
    this.style = {
      border: p.border ?? new Color(102, 102, 102),
      background: p.background,
      color: p.color ?? new Color(0, 0, 0),
      fontSize: 0,
      borderWidth: p.borderWidth ?? 1,
    };
  }

  calculateLayout(_constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    this.width = this.size;
    this.height = this.size;
    return { width: this.size, height: this.size };
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

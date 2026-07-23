import { Color } from "../../common/color.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "../pdf-element.ts";
import type { FieldStyle, RadioSpec } from "../../forms/field.ts";

export interface RadioParams {
  /** The shared group name - radios with the same `group` are one mutually-exclusive field. */
  group: string;
  /** This button's export value - unique within the group. */
  value: string;
  /** Whether this button starts selected (at most one per group should be). */
  selected?: boolean;
  /** Tooltip / accessible name. */
  tooltip?: string;
  /** Show but do not allow changing the group. */
  readOnly?: boolean;
  /** Button diameter in points (default 14). */
  size?: number;
  /** Dot colour (default black). */
  color?: Color;
  /** Ring colour (default a mid grey). */
  border?: Color;
  /** Fill behind the ring. */
  background?: Color;
  /** Ring thickness (default 1). */
  borderWidth?: number;
}

/**
 * One radio button (AcroForm /Btn, Radio flag). A small round leaf; several sharing a `group` become one
 * mutually-exclusive field (see `RadioGroup` for the ergonomic wrapper). Draws nothing itself - it emits a
 * `formfield` IR node whose radio spec bakes the ring + dot /AP at the seam.
 */
export class RadioElement extends SizedPDFElement {
  private spec: RadioSpec;
  private style: FieldStyle;
  private size: number;

  constructor(p: RadioParams) {
    const size = p.size ?? 14;
    super({ x: 0, y: 0, width: size, height: size });
    this.size = size;
    this.spec = {
      kind: "radio",
      group: p.group,
      value: p.value,
      selected: p.selected,
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

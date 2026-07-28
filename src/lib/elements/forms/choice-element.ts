import { Color } from "../../common/color.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "../pdf-element.ts";
import type { ChoiceOption, ChoiceSpec, FieldAlign, FieldStyle } from "../../forms/field.ts";

export interface ChoiceParams {
  name: string;
  options: ChoiceOption[];
  /** `true` = dropdown (combo box), `false` = list box. */
  combo: boolean;
  editable?: boolean;
  multiSelect?: boolean;
  value?: string;
  values?: string[];
  tooltip?: string;
  readOnly?: boolean;
  /** How the value sits in the box (default left). */
  align?: FieldAlign;
  /** Mark it as a field that must be filled in before submitting. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). */
  print?: boolean;
  /** Box width; omit to fill the offered width. */
  width?: number;
  /** Box height; omit for a single-line default (dropdown) / a few rows (list box). */
  height?: number;
  fontSize?: number;
  color?: Color;
  border?: Color;
  background?: Color;
  borderWidth?: number;
}

/**
 * A choice field (AcroForm /Ch) - a dropdown or a list box, chosen by `combo`. A leaf that draws nothing
 * itself: it reserves its box and emits a `formfield` IR node. The selected value is rendered by the
 * viewer via /NeedAppearances (Step 1); Step 4 bakes its /AP.
 */
export class ChoiceElement extends SizedPDFElement {
  private spec: ChoiceSpec;
  private style: FieldStyle;
  private requested: { width?: number; height?: number; fontSize: number; combo: boolean };

  constructor(p: ChoiceParams) {
    super({ x: 0, y: 0, width: p.width, height: p.height });
    const fontSize = p.fontSize ?? 12;
    this.spec = {
      kind: "choice",
      name: p.name,
      options: p.options,
      combo: p.combo,
      editable: p.editable,
      multiSelect: p.multiSelect,
      value: p.value,
      values: p.values,
      tooltip: p.tooltip,
      readOnly: p.readOnly,
      align: p.align,
      required: p.required,
      hidden: p.hidden,
      print: p.print,
    };
    this.style = {
      border: p.border ?? new Color(154, 164, 178),
      background: p.background,
      color: p.color ?? new Color(0, 0, 0),
      fontSize,
      borderWidth: p.borderWidth ?? 1,
    };
    this.requested = { width: p.width, height: p.height, fontSize, combo: p.combo };
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    this.width = this.requested.width ?? (constraints.hasBoundedWidth ? constraints.maxWidth : 200);
    // Dropdown: one line. List box: a few rows tall so several options are visible.
    const oneLine = this.requested.fontSize + 9;
    const rows = Math.max(3, Math.min(this.spec.options.length, 5));
    this.height =
      this.requested.height ??
      (this.requested.combo ? oneLine : rows * (this.requested.fontSize + 4));
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

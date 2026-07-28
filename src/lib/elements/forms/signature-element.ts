import { Color } from "../../common/color.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "../pdf-element.ts";
import type { FieldStyle, SignatureSpec } from "../../forms/field.ts";

export interface SignatureFieldParams {
  /** The field name (/T) - unique in the document. */
  name: string;
  /** A hint drawn inside the empty box, e.g. "Signature". */
  label?: string;
  /** Tooltip / accessible name. */
  tooltip?: string;
  /** Draw it but do not let it be signed. */
  readOnly?: boolean;
  /** Mark it as a field that must be filled in before submitting. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). */
  print?: boolean;
  /** Box width in points; omit to fill the offered width. */
  width?: number;
  /** Box height in points (default 48 - room for a signature). */
  height?: number;
  /** Hint font size (default 9). */
  fontSize?: number;
  /** Hint colour (default a muted grey). */
  color?: Color;
  /** Box border + signing-rule colour (default a mid grey). */
  border?: Color;
  /** Box background fill. */
  background?: Color;
  /** Border thickness (default 1). */
  borderWidth?: number;
}

/**
 * A signature field (AcroForm /Sig) - a PLACEHOLDER someone can sign later. jasy creates the field and
 * its empty "sign here" appearance; it does not sign (that needs a certificate and a byte-range digest -
 * a separate feature). Draws nothing itself: it reserves its box and emits a `formfield` IR node.
 */
export class SignatureFieldElement extends SizedPDFElement {
  private spec: SignatureSpec;
  private style: FieldStyle;
  private requested: { width?: number; height?: number };

  constructor(p: SignatureFieldParams) {
    super({ x: 0, y: 0, width: p.width, height: p.height });
    this.spec = {
      kind: "signature",
      name: p.name,
      label: p.label,
      tooltip: p.tooltip,
      readOnly: p.readOnly,
      required: p.required,
      hidden: p.hidden,
      print: p.print,
    };
    this.style = {
      border: p.border ?? new Color(154, 164, 178),
      background: p.background,
      color: p.color ?? new Color(107, 114, 128),
      fontSize: p.fontSize ?? 9,
      borderWidth: p.borderWidth ?? 1,
    };
    this.requested = { width: p.width, height: p.height };
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    this.width = this.requested.width ?? (constraints.hasBoundedWidth ? constraints.maxWidth : 240);
    this.height = this.requested.height ?? 48;
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

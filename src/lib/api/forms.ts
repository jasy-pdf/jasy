import { TextFieldElement } from "../elements/forms/text-field-element.ts";
import { CheckboxElement } from "../elements/forms/checkbox-element.ts";
import { ColorInput, toColor } from "./color.ts";

/** Options for a `TextField` - an interactive text input in the generated PDF. */
export interface TextFieldOptions {
  /** The field name - unique in the document; you read the value back by it. */
  name: string;
  /** Initial value. */
  value?: string;
  /** Tooltip / accessible name shown on hover. */
  tooltip?: string;
  /** Accept multiple lines instead of one (give the box a `height` to match). */
  multiline?: boolean;
  /** Mask the typed characters (a password field). */
  password?: boolean;
  /** Maximum number of characters. */
  maxLength?: number;
  /** Show the value but do not let the user edit it. */
  readOnly?: boolean;
  /** Box width in points; omit to fill the offered width. */
  width?: number;
  /** Box height in points; omit for a single-line default. */
  height?: number;
  /** Value font size in points; `0` lets the viewer auto-size. */
  fontSize?: number;
  /** Value text colour (named / hex / rgb). */
  color?: ColorInput;
  /** Box border colour; omit for no border. */
  border?: ColorInput;
  /** Box background fill; omit for transparent. */
  background?: ColorInput;
  /** Border thickness in points (default 1 when a border is set). */
  borderWidth?: number;
}

/**
 * An interactive text field the reader of the PDF can type into (AcroForm /Tx). Place it like any element -
 * in a `Column`, `Row`, `Box` or a table cell; it reserves its box and becomes a fillable widget.
 *
 * ```ts
 * TextField({ name: "email", border: "gray", height: 22 })
 * ```
 */
export function TextField(opts: TextFieldOptions): TextFieldElement {
  return new TextFieldElement({
    ...opts,
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    border: opts.border !== undefined ? toColor(opts.border) : undefined,
    background: opts.background !== undefined ? toColor(opts.background) : undefined,
  });
}

/** Options for a `Checkbox` - a toggle the reader of the PDF can tick. */
export interface CheckboxOptions {
  /** The field name - unique in the document. */
  name: string;
  /** Whether it starts checked. */
  checked?: boolean;
  /** The "on" export value stored when checked (default `"Yes"`). */
  onValue?: string;
  /** Tooltip / accessible name shown on hover. */
  tooltip?: string;
  /** Show the state but do not let the user toggle it. */
  readOnly?: boolean;
  /** Box side length in points (default 14). */
  size?: number;
  /** Checkmark colour (default black). */
  color?: ColorInput;
  /** Box border colour (default a mid grey). */
  border?: ColorInput;
  /** Box background fill. */
  background?: ColorInput;
  /** Border thickness in points (default 1). */
  borderWidth?: number;
}

/**
 * An interactive checkbox (AcroForm /Btn). It bakes its own checkmark appearance, so the tick shows in
 * any viewer, in print, and under PDF/A - not only in ones that regenerate appearances.
 *
 * ```ts
 * Row({ gap: 6, align: "center" }, [Checkbox({ name: "agree" }), Text("I agree")])
 * ```
 */
export function Checkbox(opts: CheckboxOptions): CheckboxElement {
  return new CheckboxElement({
    ...opts,
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    border: opts.border !== undefined ? toColor(opts.border) : undefined,
    background: opts.background !== undefined ? toColor(opts.background) : undefined,
  });
}

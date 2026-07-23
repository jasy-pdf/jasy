import { PDFElement } from "../elements/pdf-element.ts";
import { TextFieldElement } from "../elements/forms/text-field-element.ts";
import { CheckboxElement } from "../elements/forms/checkbox-element.ts";
import { RadioElement } from "../elements/forms/radio-element.ts";
import { ColorInput, toColor } from "./color.ts";
import { Column, Row } from "./layout.ts";
import { Text } from "./text.ts";

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

/** Options for a single `Radio` button. Several sharing a `group` are one mutually-exclusive field. */
export interface RadioOptions {
  /** The shared group name - radios with the same `group` are one field. */
  group: string;
  /** This button's export value - unique within the group. */
  value: string;
  /** Whether it starts selected. */
  selected?: boolean;
  /** Tooltip / accessible name. */
  tooltip?: string;
  /** Show but do not allow changing. */
  readOnly?: boolean;
  /** Button diameter in points (default 14). */
  size?: number;
  /** Dot colour. */
  color?: ColorInput;
  /** Ring colour. */
  border?: ColorInput;
  /** Fill behind the ring. */
  background?: ColorInput;
  /** Ring thickness. */
  borderWidth?: number;
}

/** A single radio button. Use `RadioGroup` for the common labelled-list layout, or this for custom ones. */
export function Radio(opts: RadioOptions): RadioElement {
  return new RadioElement({
    ...opts,
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    border: opts.border !== undefined ? toColor(opts.border) : undefined,
    background: opts.background !== undefined ? toColor(opts.background) : undefined,
  });
}

/** One option in a `RadioGroup`. */
export interface RadioChoice {
  /** The export value stored when this option is picked. */
  value: string;
  /** The text shown next to the button. */
  label: string;
}

/** Options for a `RadioGroup` - the labelled list of mutually-exclusive buttons. */
export interface RadioGroupOptions {
  /** The field name (shared by every button). */
  name: string;
  /** The value of the option that starts selected (matches one option's `value`). */
  value?: string;
  /** Vertical space between options (default 8). */
  gap?: number;
  /** Button diameter (default 14). */
  size?: number;
  /** Button ring / dot / background colours, applied to every option. */
  color?: ColorInput;
  border?: ColorInput;
  background?: ColorInput;
  /** Label font size (default 12) and colour. */
  labelSize?: number;
  labelColor?: ColorInput;
}

/**
 * A labelled group of mutually-exclusive radio buttons. Sugar over `Radio` + `Text`: it lays each option
 * out as a button-and-label row in a `Column`, and marks the one whose `value` matches the group `value`.
 *
 * ```ts
 * RadioGroup({ name: "size", value: "m" }, [
 *   { value: "s", label: "Small" },
 *   { value: "m", label: "Medium" },
 *   { value: "l", label: "Large" },
 * ])
 * ```
 */
export function RadioGroup(opts: RadioGroupOptions, options: RadioChoice[]): PDFElement {
  const rows = options.map((o) =>
    Row({ gap: 8, align: "center" }, [
      Radio({
        group: opts.name,
        value: o.value,
        selected: o.value === opts.value,
        size: opts.size,
        color: opts.color,
        border: opts.border,
        background: opts.background,
      }),
      Text(o.label, { size: opts.labelSize ?? 12, color: opts.labelColor }),
    ]),
  );
  return Column({ gap: opts.gap ?? 8 }, rows);
}

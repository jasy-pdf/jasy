import { PDFElement } from "../elements/pdf-element.ts";
import { TextFieldElement } from "../elements/forms/text-field-element.ts";
import { CheckboxElement } from "../elements/forms/checkbox-element.ts";
import { RadioElement } from "../elements/forms/radio-element.ts";
import { ChoiceElement } from "../elements/forms/choice-element.ts";
import { PushButtonElement } from "../elements/forms/push-button-element.ts";
import { SignatureFieldElement } from "../elements/forms/signature-element.ts";
import type { ButtonAction, ChoiceOption, FieldAlign } from "../forms/field.ts";
import { ColorInput, toColor } from "./color.ts";
import { Column, Row } from "./layout.ts";
import { Text } from "./text.ts";

/** A choice option: a plain string (value = label) or `{ value, label }`. */
export type ChoiceOptionInput = string | { value: string; label?: string };
const toOptions = (opts: ChoiceOptionInput[]): ChoiceOption[] =>
  opts.map((o) => (typeof o === "string" ? { value: o } : o));

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
  /** How the value sits in the box: left (default), center or right. */
  align?: FieldAlign;
  /** Maximum number of characters. */
  maxLength?: number;
  /** Show the value but do not let the user edit it. */
  readOnly?: boolean;
  /** Mark it as a field that must be filled in before the form is submitted. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). `false` keeps it on screen only. */
  print?: boolean;
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
  /** Text placed beside the box. Given one, the box and the text become a row - the same shape
   *  `RadioGroup` builds for its choices, so a lone check box does not have to be assembled by hand. */
  label?: string;
  /** Size of the label text (default 12). */
  labelSize?: number;
  /** Colour of the label text. */
  labelColor?: ColorInput;
  /** Space between the box and its label, in points (default 8). */
  labelGap?: number;
  /** Whether it starts checked. */
  checked?: boolean;
  /** The "on" export value stored when checked (default `"Yes"`). */
  onValue?: string;
  /** Tooltip / accessible name shown on hover. */
  tooltip?: string;
  /** Show the state but do not let the user toggle it. */
  readOnly?: boolean;
  /** Mark it as a field that must be filled in before the form is submitted. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). `false` keeps it on screen only. */
  print?: boolean;
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
export function Checkbox(opts: CheckboxOptions): PDFElement {
  const box = new CheckboxElement({
    ...opts,
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    border: opts.border !== undefined ? toColor(opts.border) : undefined,
    background: opts.background !== undefined ? toColor(opts.background) : undefined,
  });
  // Without a label the box IS the element, so nothing wraps it and the output is unchanged.
  if (opts.label === undefined) return box;
  return Row({ gap: opts.labelGap ?? 8, align: "center" }, [
    box,
    Text(opts.label, { size: opts.labelSize ?? 12, color: opts.labelColor }),
  ]);
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
  /** Mark it as a field that must be filled in before the form is submitted. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). `false` keeps it on screen only. */
  print?: boolean;
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
  /** Mark the group as required. */
  required?: boolean;
  /** Hide every button - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the buttons when printing (default true). */
  print?: boolean;
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
        required: opts.required,
        hidden: opts.hidden,
        print: opts.print,
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

/** Style + geometry shared by `Dropdown` and `ListBox`. */
interface ChoiceStyleOptions {
  /** How the value sits in the box: left (default), center or right. */
  align?: FieldAlign;
  tooltip?: string;
  readOnly?: boolean;
  /** Mark it as a field that must be filled in before the form is submitted. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). `false` keeps it on screen only. */
  print?: boolean;
  width?: number;
  height?: number;
  fontSize?: number;
  color?: ColorInput;
  border?: ColorInput;
  background?: ColorInput;
  borderWidth?: number;
}

const choiceStyle = (o: ChoiceStyleOptions) => ({
  align: o.align,
  tooltip: o.tooltip,
  readOnly: o.readOnly,
  required: o.required,
  hidden: o.hidden,
  print: o.print,
  width: o.width,
  height: o.height,
  fontSize: o.fontSize,
  color: o.color !== undefined ? toColor(o.color) : undefined,
  border: o.border !== undefined ? toColor(o.border) : undefined,
  background: o.background !== undefined ? toColor(o.background) : undefined,
  borderWidth: o.borderWidth,
});

/** Options for a `Dropdown` (combo box). */
export interface DropdownOptions extends ChoiceStyleOptions {
  /** The field name. */
  name: string;
  /** The selected value. */
  value?: string;
  /** Let the reader type a value that is not in the list. */
  editable?: boolean;
}

/**
 * A dropdown / combo box (AcroForm /Ch). Options are plain strings or `{ value, label }`.
 *
 * ```ts
 * Dropdown({ name: "country", value: "de" }, [{ value: "de", label: "Germany" }, "France"])
 * ```
 */
export function Dropdown(opts: DropdownOptions, options: ChoiceOptionInput[]): ChoiceElement {
  return new ChoiceElement({
    name: opts.name,
    options: toOptions(options),
    combo: true,
    editable: opts.editable,
    value: opts.value,
    ...choiceStyle(opts),
  });
}

/** `Select` is an alias for `Dropdown`. */
export const Select = Dropdown;

/** Options for a `ListBox`. */
export interface ListBoxOptions extends ChoiceStyleOptions {
  /** The field name. */
  name: string;
  /** The selected value (single-select). */
  value?: string;
  /** The selected values (when `multiSelect`). */
  values?: string[];
  /** Allow more than one selection. */
  multiSelect?: boolean;
}

/**
 * A scrollable list box (AcroForm /Ch). Give it a `height` to show more rows. Set `multiSelect` for
 * several selections at once.
 */
export function ListBox(opts: ListBoxOptions, options: ChoiceOptionInput[]): ChoiceElement {
  return new ChoiceElement({
    name: opts.name,
    options: toOptions(options),
    combo: false,
    multiSelect: opts.multiSelect,
    value: opts.value,
    values: opts.values,
    ...choiceStyle(opts),
  });
}

/**
 * What a `PushButton` does when clicked: `"reset"` clears the form, `{ submit: url }` posts the field
 * values, `{ open: url }` opens a link. Omit it for a button that does nothing. Scripted (JavaScript)
 * actions are deliberately not offered - a jasy form is data, not a program.
 *
 * VIEWER SUPPORT. All three actions we emit are spec-correct; what differs is what a viewer implements.
 * PROVEN, not assumed - the same cases built with pdf-lib (an independent producer) behave identically,
 * so none of this is a jasy bug. Measured 2026-07 in pdf.js (VS Code) and poppler/Evince:
 *   - `"reset"`         - works in both. The safe one.
 *   - `{ open: url }`   - works in pdf.js, dead in Evince, and NOT fixable from here: poppler's glib
 *                         layer surfaces actions only through `poppler_page_get_link_mapping` (i.e.
 *                         /Link annotations); its form-field API has no action getter at all, so a
 *                         WIDGET's /A can never be reached. **For a plain hyperlink use `Link({ href })`**
 *                         - the identical URI action on a real /Link annotation works in both.
 *   - `{ submit: url }` - Acrobat only. `POPPLER_ACTION_SUBMIT_FORM` does not exist in poppler-glib (no
 *                         such enum value), and pdf.js does not implement /SubmitForm either.
 * Ruled out as causes: pdf-lib splits field and widget, sets /P and a /D appearance - and still fails
 * the same way, so none of those structural differences matter.
 */
export type ButtonActionInput = "reset" | { submit: string } | { open: string };

const toAction = (a?: ButtonActionInput): ButtonAction | undefined => {
  if (a === undefined) return undefined;
  if (a === "reset") return { kind: "reset" };
  return "submit" in a ? { kind: "submit", url: a.submit } : { kind: "url", url: a.open };
};

/** Options for a `PushButton`. */
export interface PushButtonOptions {
  /** The field name - unique in the document. */
  name: string;
  /** The caption drawn on the button. */
  label: string;
  /** What clicking it does. */
  action?: ButtonActionInput;
  /** Tooltip / accessible name shown on hover. */
  tooltip?: string;
  /** Draw it but do not let it be clicked. */
  readOnly?: boolean;
  /** Mark it as a field that must be filled in before the form is submitted. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). `false` keeps it on screen only. */
  print?: boolean;
  /** Width in points; omit to fill the offered width. */
  width?: number;
  /** Height in points; omit for a comfortable default. */
  height?: number;
  /** Caption font size (default 12). */
  fontSize?: number;
  /** Caption colour. */
  color?: ColorInput;
  /** Border colour. */
  border?: ColorInput;
  /** Button face fill. */
  background?: ColorInput;
  /** Border thickness in points. */
  borderWidth?: number;
}

/**
 * A clickable push button (AcroForm /Btn). It holds no value - it fires an action. Its caption is baked
 * into the appearance, so the button looks the same in every viewer and in print.
 *
 * ```ts
 * PushButton({ name: "send", label: "Submit", action: { submit: "https://example.com/f" }, width: 120 })
 * PushButton({ name: "clear", label: "Reset", action: "reset", width: 90 })
 * ```
 */
export function PushButton(opts: PushButtonOptions): PushButtonElement {
  return new PushButtonElement({
    name: opts.name,
    label: opts.label,
    action: toAction(opts.action),
    tooltip: opts.tooltip,
    readOnly: opts.readOnly,
    required: opts.required,
    hidden: opts.hidden,
    print: opts.print,
    width: opts.width,
    height: opts.height,
    fontSize: opts.fontSize,
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    border: opts.border !== undefined ? toColor(opts.border) : undefined,
    background: opts.background !== undefined ? toColor(opts.background) : undefined,
    borderWidth: opts.borderWidth,
  });
}

/** Options for a `SignatureField`. */
export interface SignatureFieldOptions {
  /** The field name - unique in the document. */
  name: string;
  /** A hint drawn inside the empty box, e.g. "Signature" or "Approved by". */
  label?: string;
  /** Tooltip / accessible name shown on hover. */
  tooltip?: string;
  /** Draw it but do not let it be signed. */
  readOnly?: boolean;
  /** Mark it as a field that must be filled in before the form is submitted. */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). `false` keeps it on screen only. */
  print?: boolean;
  /** Width in points; omit to fill the offered width. */
  width?: number;
  /** Height in points (default 48). */
  height?: number;
  /** Hint font size (default 9). */
  fontSize?: number;
  /** Hint colour. */
  color?: ColorInput;
  /** Box border + signing-rule colour. */
  border?: ColorInput;
  /** Box background fill. */
  background?: ColorInput;
  /** Border thickness in points. */
  borderWidth?: number;
}

/**
 * A signature field (AcroForm /Sig) - a placeholder someone can sign later in a PDF tool. jasy creates
 * the field and draws its empty "sign here" box; it does not apply signatures itself (real signing needs
 * a certificate and a byte-range digest).
 *
 * ```ts
 * SignatureField({ name: "approver", label: "Signature", width: 240 })
 * ```
 */
export function SignatureField(opts: SignatureFieldOptions): SignatureFieldElement {
  return new SignatureFieldElement({
    ...opts,
    color: opts.color !== undefined ? toColor(opts.color) : undefined,
    border: opts.border !== undefined ? toColor(opts.border) : undefined,
    background: opts.background !== undefined ? toColor(opts.background) : undefined,
  });
}

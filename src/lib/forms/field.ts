import type { Color } from "../common/color.ts";

/**
 * The semantic description of ONE AcroForm field, independent of whether it is being CREATED (the field
 * elements produce it) or FILLED in an existing PDF (the reader parses existing fields into it, later).
 * This shared model is the spine that makes "create" and "fill existing" two parts of one feature.
 *
 * A discriminated union, one `kind` per PDF field family (/Tx, /Btn, /Ch, /Sig). Step 1 implements
 * `text`; the union grows a member per family as the field types land.
 */
export type FormFieldSpec =
  | TextFieldSpec
  | CheckboxSpec
  | RadioSpec
  | ChoiceSpec
  | PushButtonSpec
  | SignatureSpec;

/**
 * A variable text field (/Tx). The PDF variants live in field flags; here they are typed props, so you
 * never hand-assemble a `/Ff` bitmask.
 */
export interface TextFieldSpec {
  kind: "text";
  /** The field's name (/T) - what you read the value back by. Must be unique in the document. */
  name: string;
  /** The current text value (/V). */
  value?: string;
  /** A tooltip / accessible name for the field (/TU). */
  tooltip?: string;
  /** Wrap across multiple lines instead of a single line (the Multiline flag). */
  multiline?: boolean;
  /** Mask the typed characters (the Password flag). */
  password?: boolean;
  /** Maximum number of characters the field accepts (/MaxLen). */
  maxLength?: number;
  /** The value is shown but cannot be edited (the ReadOnly flag). */
  readOnly?: boolean;
}

/**
 * A checkbox (/Btn, neither the Radio nor the Pushbutton flag). Its value is the "on" export name when
 * checked and `Off` when not - PDF checkboxes use NAMES, not strings; we hide that behind `checked`.
 */
export interface CheckboxSpec {
  kind: "checkbox";
  /** The field name (/T). */
  name: string;
  /** Whether it starts checked. */
  checked?: boolean;
  /** The "on" export value (the /AP state name + /V when checked). Default `"Yes"`. */
  onValue?: string;
  /** A tooltip / accessible name (/TU). */
  tooltip?: string;
  /** Show but do not allow toggling. */
  readOnly?: boolean;
}

/**
 * One radio button (/Btn with the Radio flag). Every radio sharing a `group` is ONE AcroForm field whose
 * `/Kids` are the individual buttons - mutually exclusive, so picking one clears the rest. `value` is this
 * button's export name (unique within the group); it becomes the field's value when this one is picked.
 */
export interface RadioSpec {
  kind: "radio";
  /** The shared group name (/T of the parent field). All radios with the same `group` are one field. */
  group: string;
  /** This button's export value - unique in the group; the field's /V when this one is selected. */
  value: string;
  /** Whether this button starts selected (at most one per group should be). */
  selected?: boolean;
  /** A tooltip / accessible name. */
  tooltip?: string;
  /** Show but do not allow changing the group. */
  readOnly?: boolean;
}

/** One entry of a choice field. `label` is what the reader sees; `value` is what gets stored. */
export interface ChoiceOption {
  value: string;
  label?: string;
}

/**
 * A choice field (/Ch): a dropdown (combo box) or a list box. `combo` picks which. The value(s) are
 * export strings from `options`. A combo may be `editable` (the reader can type a value not in the list);
 * a list box may allow `multiSelect`.
 */
export interface ChoiceSpec {
  kind: "choice";
  /** The field name (/T). */
  name: string;
  /** The selectable options. */
  options: ChoiceOption[];
  /** `true` = dropdown (combo box), `false` = list box. */
  combo: boolean;
  /** Combo only: let the reader type a value that is not in the list. */
  editable?: boolean;
  /** List box only: allow more than one selection. */
  multiSelect?: boolean;
  /** The selected value (single-select). */
  value?: string;
  /** The selected values (a `multiSelect` list box). */
  values?: string[];
  /** Tooltip / accessible name. */
  tooltip?: string;
  /** Show but do not allow changing. */
  readOnly?: boolean;
}

/**
 * What a push button does when clicked. A typed union, so an action can never be half-specified (a
 * submit without a target is not expressible). Scripted (JavaScript) actions are deliberately out of
 * scope - a jasy form is data, not a program.
 */
export type ButtonAction =
  | { kind: "reset" }
  | { kind: "submit"; url: string }
  | { kind: "url"; url: string };

/**
 * A push button (/Btn with the Pushbutton flag). Unlike every other field it holds NO value - it is a
 * click target that fires an action. Its caption is baked into the appearance stream, so the button
 * looks the same in every viewer and in print.
 */
export interface PushButtonSpec {
  kind: "pushbutton";
  /** The field name (/T). */
  name: string;
  /** The caption drawn on the button. */
  label: string;
  /** What clicking it does; omit for a button that does nothing (a plain label). */
  action?: ButtonAction;
  /** A tooltip / accessible name (/TU). */
  tooltip?: string;
  /** Draw it but do not let it be clicked. */
  readOnly?: boolean;
}

/**
 * A signature field (/Sig) - a PLACEHOLDER where a signature can later be applied. jasy creates the
 * field and its empty appearance; it does not sign (real signing needs a certificate and a byte-range
 * digest, a separate feature). An unsigned field has no /V; a signer fills that in later.
 */
export interface SignatureSpec {
  kind: "signature";
  /** The field name (/T). */
  name: string;
  /** A hint drawn inside the empty box, e.g. "Signature" or the signer's role. */
  label?: string;
  /** A tooltip / accessible name (/TU). */
  tooltip?: string;
  /** Draw it but do not let it be signed. */
  readOnly?: boolean;
}

/**
 * How a field's WIDGET is painted: the box (border + fill) and how its value looks (font size + colour).
 * Kept separate from the semantic spec because it maps to the widget `/MK` + `/DA`, not the field value -
 * and the fill-existing path reuses it to restyle a field it did not create.
 */
export interface FieldStyle {
  /** Border (stroke) colour of the field box. Omit for no border. */
  border?: Color;
  /** Background fill of the field box. Omit for transparent. */
  background?: Color;
  /** The value's text colour (drawn into `/DA`). */
  color: Color;
  /** Font size in points; `0` lets the viewer auto-size to the box (the PDF convention). */
  fontSize: number;
  /** Border thickness in points (only drawn when a `border` is set). */
  borderWidth: number;
}

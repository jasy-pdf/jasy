import type { Color } from "../common/color.ts";

/**
 * The semantic description of ONE AcroForm field, independent of whether it is being CREATED (the field
 * elements produce it) or FILLED in an existing PDF (the reader parses existing fields into it, later).
 * This shared model is the spine that makes "create" and "fill existing" two parts of one feature.
 *
 * A discriminated union, one `kind` per PDF field family (/Tx, /Btn, /Ch, /Sig) - all of them
 * implemented, so a `switch` over `kind` is exhaustive.
 */
export type FormFieldSpec =
  | TextFieldSpec
  | CheckboxSpec
  | RadioSpec
  | ChoiceSpec
  | PushButtonSpec
  | SignatureSpec;

/**
 * What every field kind shares, whatever its family. Kept in one place so a new field type cannot
 * silently miss them.
 */
export interface CommonFieldProps {
  /** A tooltip / accessible name (/TU). */
  tooltip?: string;
  /** Show the field but do not let it be changed. */
  readOnly?: boolean;
  /** Mark it as a field that must be filled in before the form is submitted (/Ff Required). */
  required?: boolean;
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden?: boolean;
  /** Include the widget when printing (default true). `false` keeps it on screen only. */
  print?: boolean;
}

/** How a value is aligned inside its field box (the PDF calls this "quadding", /Q). */
export type FieldAlign = "left" | "center" | "right";

/**
 * A variable text field (/Tx). The PDF variants live in field flags; here they are typed props, so you
 * never hand-assemble a `/Ff` bitmask.
 */
export interface TextFieldSpec extends CommonFieldProps {
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
  /** How the value sits in the box (default left). Applies to the baked appearance AND /Q. */
  align?: FieldAlign;
  /** Maximum number of characters the field accepts (/MaxLen). */
  maxLength?: number;
}

/**
 * A checkbox (/Btn, neither the Radio nor the Pushbutton flag). Its value is the "on" export name when
 * checked and `Off` when not - PDF checkboxes use NAMES, not strings; we hide that behind `checked`.
 */
export interface CheckboxSpec extends CommonFieldProps {
  kind: "checkbox";
  /** The field name (/T). */
  name: string;
  /** Whether it starts checked. */
  checked?: boolean;
  /** The "on" export value (the /AP state name + /V when checked). Default `"Yes"`. */
  onValue?: string;
}

/**
 * One radio button (/Btn with the Radio flag). Every radio sharing a `group` is ONE AcroForm field whose
 * `/Kids` are the individual buttons - mutually exclusive, so picking one clears the rest. `value` is this
 * button's export name (unique within the group); it becomes the field's value when this one is picked.
 */
export interface RadioSpec extends CommonFieldProps {
  kind: "radio";
  /** The shared group name (/T of the parent field). All radios with the same `group` are one field. */
  group: string;
  /** This button's export value - unique in the group; the field's /V when this one is selected. */
  value: string;
  /** Whether this button starts selected (at most one per group should be). */
  selected?: boolean;
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
export interface ChoiceSpec extends CommonFieldProps {
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
  /** How the value sits in the box (default left). */
  align?: FieldAlign;
  /** The selected values (a `multiSelect` list box). */
  values?: string[];
  /** Tooltip / accessible name. */
  tooltip?: string;
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
export interface PushButtonSpec extends CommonFieldProps {
  kind: "pushbutton";
  /** The field name (/T). */
  name: string;
  /** The caption drawn on the button. */
  label: string;
  /** What clicking it does; omit for a button that does nothing (a plain label). */
  action?: ButtonAction;
}

/**
 * A signature field (/Sig) - a PLACEHOLDER where a signature can later be applied. jasy creates the
 * field and its empty appearance; it does not sign (real signing needs a certificate and a byte-range
 * digest, a separate feature). An unsigned field has no /V; a signer fills that in later.
 */
export interface SignatureSpec extends CommonFieldProps {
  kind: "signature";
  /** The field name (/T). */
  name: string;
  /** A hint drawn inside the empty box, e.g. "Signature" or the signer's role. */
  label?: string;
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

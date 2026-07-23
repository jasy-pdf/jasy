import type { Color } from "../common/color.ts";

/**
 * The semantic description of ONE AcroForm field, independent of whether it is being CREATED (the field
 * elements produce it) or FILLED in an existing PDF (the reader parses existing fields into it, later).
 * This shared model is the spine that makes "create" and "fill existing" two parts of one feature.
 *
 * A discriminated union, one `kind` per PDF field family (/Tx, /Btn, /Ch, /Sig). Step 1 implements
 * `text`; the union grows a member per family as the field types land.
 */
export type FormFieldSpec = TextFieldSpec | CheckboxSpec;
// Growing: | RadioSpec | ChoiceSpec | PushButtonSpec | SignatureSpec

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

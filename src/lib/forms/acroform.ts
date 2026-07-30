import type { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import type { FormFieldNode } from "../ir/display-list.ts";
import { NORMAL_STYLE, escName, num2, pdfColor } from "./pdf.ts";
import {
  type FieldLine,
  checkboxOff,
  checkboxOn,
  listBoxFace,
  pushButtonFace,
  radioOff,
  radioOn,
  signatureFace,
  textFieldFace,
  wrapFieldValue,
} from "./appearance.ts";
import type { ButtonAction, ChoiceSpec, FieldAlign, FieldStyle, FormFieldSpec } from "./field.ts";

// AcroForm field flags (/Ff), by 1-based bit position per the PDF spec.
const FF_READ_ONLY = 1 << 0; // bit 1
const FF_REQUIRED = 1 << 1; // bit 2: must be filled in before the form is submitted
const FF_MULTILINE = 1 << 12; // bit 13 (text)
const FF_PASSWORD = 1 << 13; // bit 14 (text)
const FF_NO_TOGGLE_OFF = 1 << 14; // bit 15 (button): clicking the selected radio does not clear it
const FF_RADIO = 1 << 15; // bit 16 (button): the group's kids are mutually exclusive
const FF_PUSHBUTTON = 1 << 16; // bit 17 (button): a click target with no value
const FF_COMBO = 1 << 17; // bit 18 (choice): a dropdown, not a list box
const FF_EDIT = 1 << 18; // bit 19 (choice): a combo whose value may be typed, not only picked
const FF_MULTI_SELECT = 1 << 21; // bit 22 (choice): a list box that allows several selections

/** The `/MK` (appearance characteristics) + `/BS` (border style) shared by every widget: the box border
 *  colour + fill + width. `extraMK` adds field-specific entries (a push button's `/CA` caption) to the
 *  SAME /MK dict. Empty when the field has neither a border, a background nor an extra entry. */
function boxChrome(node: FormFieldNode, extraMK = ""): string {
  const { style } = node;
  const mk: string[] = [];
  if (extraMK) mk.push(extraMK);
  if (style.border) mk.push(`/BC [${pdfColor(style.border)}]`);
  if (style.background) mk.push(`/BG [${pdfColor(style.background)}]`);
  let out = mk.length ? ` /MK << ${mk.join(" ")} >>` : "";
  if (style.border && style.borderWidth > 0)
    out += ` /BS << /W ${num2(style.borderWidth)} /S /S >>`;
  return out;
}

/** The annotation flags (/F). Bit 2 = Hidden, bit 3 = Print. A widget prints by default; `hidden`
 *  removes it from screen AND print, `print: false` keeps it on screen only. */
function annotFlags(f: FormFieldSpec): number {
  if (f.hidden) return 2;
  return f.print === false ? 0 : 4;
}

/** The field flags every kind shares. */
function commonFlags(f: FormFieldSpec): number {
  return (f.readOnly ? FF_READ_ONLY : 0) | (f.required ? FF_REQUIRED : 0);
}

/** Quadding (/Q): 0 left (the default, so we omit it), 1 centre, 2 right. */
function quadding(align?: FieldAlign): string {
  if (align === "center") return " /Q 1";
  if (align === "right") return " /Q 2";
  return "";
}

function rectOf(node: FormFieldNode): string {
  return `[${num2(node.x)} ${num2(node.y)} ${num2(node.x + node.width)} ${num2(node.y + node.height)}]`;
}

/** A text field (/Tx). `apRef` is its baked appearance (the default); without one the field carries only
 *  /DA and the viewer draws the value itself (`fieldAppearances: false`). */
function buildTextWidget(
  node: FormFieldNode,
  daFont: string,
  om: PDFObjectManager,
  apRef?: number,
): string {
  const f = node.field;
  if (f.kind !== "text") throw new Error("buildTextWidget: not a text field");
  const parts = [`/Type /Annot /Subtype /Widget /FT /Tx`, `/T ${om.pdfString(f.name)}`];
  if (f.value !== undefined) parts.push(`/V ${om.pdfString(f.value)}`);
  if (f.tooltip !== undefined) parts.push(`/TU ${om.pdfString(f.tooltip)}`);
  let flags = commonFlags(f);
  if (f.multiline) flags |= FF_MULTILINE;
  if (f.password) flags |= FF_PASSWORD;
  if (flags) parts.push(`/Ff ${flags}`);
  if (f.maxLength !== undefined) parts.push(`/MaxLen ${f.maxLength}`);
  parts.push(`/Rect ${rectOf(node)} /F ${annotFlags(f)}${quadding(f.align)}`);
  parts.push(
    `/DA ${om.pdfString(`/${daFont} ${num2(node.style.fontSize)} Tf ${pdfColor(node.style.color)} rg`)}`,
  );
  if (apRef !== undefined) parts.push(`/AP << /N ${apRef} 0 R >>`);
  return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
}

/** A checkbox (/Btn). Bakes its own /AP appearance streams for the on + off states, so the check is
 *  visible everywhere (print / headless / PDF-A), not only in viewers that honour /NeedAppearances. */
function buildCheckboxWidget(node: FormFieldNode, om: PDFObjectManager): string {
  const f = node.field;
  if (f.kind !== "checkbox") throw new Error("buildCheckboxWidget: not a checkbox");
  // Export values become Name tokens, so they are #XX-escaped, not string-escaped.
  const on = escName(f.onValue ?? "Yes");
  const state = f.checked ? on : "Off";
  const bbox = `[0 0 ${num2(node.width)} ${num2(node.height)}]`;
  // One Form XObject per state; the widget's /AS picks which one shows.
  const onRef = om.addFormXObject(bbox, checkboxOn(node.width, node.height, node.style));
  const offRef = om.addFormXObject(bbox, checkboxOff(node.width, node.height, node.style));

  const parts = [`/Type /Annot /Subtype /Widget /FT /Btn`, `/T ${om.pdfString(f.name)}`];
  if (f.tooltip !== undefined) parts.push(`/TU ${om.pdfString(f.tooltip)}`);
  if (commonFlags(f)) parts.push(`/Ff ${commonFlags(f)}`);
  parts.push(`/V /${state} /AS /${state}`);
  parts.push(`/Rect ${rectOf(node)} /F ${annotFlags(f)}`);
  parts.push(`/AP << /N << /${on} ${onRef} 0 R /Off ${offRef} 0 R >> >>`);
  // The check mark lives in ZapfDingbats. We bake the appearance ourselves, so this /DA is only read by
  // a viewer that REGENERATES (which /NeedAppearances asks for) - but then it needs it, and it needs the
  // matching /DR entry, or it silently draws an empty box.
  parts.push(`/DA ${om.pdfString(`/ZaDb 0 Tf ${pdfColor(node.style.color)} rg`)}`);
  return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
}

/** What a choice field has selected. A multi-select box uses `values`; a single-select one uses `value`
 *  but tolerates a one-entry `values` - the two props are easy to confuse, and silently dropping the
 *  user's selection is worse than accepting either spelling. */
function choiceSelection(f: ChoiceSpec): string[] {
  if (f.multiSelect) return f.values ?? (f.value !== undefined ? [f.value] : []);
  if (f.value !== undefined) return [f.value];
  return f.values?.length ? [f.values[0]] : [];
}

/** A choice field (/Ch): a dropdown (combo) or list box. `apRef` is its baked appearance (the default);
 *  without one the viewer draws the selected value from /DA + /V. */
function buildChoiceWidget(
  node: FormFieldNode,
  daFont: string,
  om: PDFObjectManager,
  apRef?: number,
): string {
  const f = node.field;
  if (f.kind !== "choice") throw new Error("buildChoiceWidget: not a choice");
  // /Opt: each entry is [ (export) (display) ], so a label can differ from the stored value.
  const opt = f.options
    .map((o) => `[${om.pdfString(o.value)} ${om.pdfString(o.label ?? o.value)}]`)
    .join(" ");
  const parts = [
    `/Type /Annot /Subtype /Widget /FT /Ch`,
    `/T ${om.pdfString(f.name)}`,
    `/Opt [${opt}]`,
  ];
  if (f.tooltip !== undefined) parts.push(`/TU ${om.pdfString(f.tooltip)}`);

  let flags = commonFlags(f);
  if (f.combo) flags |= FF_COMBO | (f.editable ? FF_EDIT : 0);
  else if (f.multiSelect) flags |= FF_MULTI_SELECT;
  if (flags) parts.push(`/Ff ${flags}`);

  const indexOf = (v: string) => f.options.findIndex((o) => o.value === v);
  const chosen = choiceSelection(f);
  if (chosen.length > 0) {
    // A multi-select field's value is an ARRAY of strings; every other choice field holds one string.
    parts.push(
      f.multiSelect
        ? `/V [${chosen.map((v) => `${om.pdfString(v)}`).join(" ")}]`
        : `/V ${om.pdfString(chosen[0])}`,
    );
    const idx = chosen.map(indexOf).filter((i) => i >= 0);
    if (idx.length) parts.push(`/I [${idx.join(" ")}]`);
  }

  parts.push(`/Rect ${rectOf(node)} /F ${annotFlags(f)}${quadding(f.align)}`);
  parts.push(
    `/DA ${om.pdfString(`/${daFont} ${num2(node.style.fontSize)} Tf ${pdfColor(node.style.color)} rg`)}`,
  );
  if (apRef !== undefined) parts.push(`/AP << /N ${apRef} 0 R >>`);
  return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
}

/** The `/A` action a push button fires. Scripted actions are deliberately not offered. */
function actionDict(a: ButtonAction, om: PDFObjectManager): string {
  switch (a.kind) {
    case "reset":
      return `/A << /S /ResetForm >>`;
    case "submit":
      // /Flags 4 = ExportFormat: post the field values as HTML form data rather than FDF, which is what
      // an ordinary web endpoint expects.
      return `/A << /S /SubmitForm /F << /FS /URL /F ${om.pdfString(a.url)} >> /Flags 4 >>`;
    case "url":
      return `/A << /S /URI /URI ${om.pdfString(a.url)} >>`;
  }
}

// One radio GROUP, collected across its individual buttons. `parentNum` is the shared /Btn field object
// (reserved up front, filled at finalize with the /Kids + the winning /V).
interface RadioGroup {
  parentNum: number;
  kids: number[];
  selected?: string;
  flags: number;
}

/**
 * Collects the document's form fields as pages render, then emits the catalog `/AcroForm` dictionary at
 * finalize. Mirrors `OutlineBuilder` / `DestRegistry`: a no-op returning "" when no field was placed, so
 * a document without a form stays byte-identical.
 */
export class AcroFormCollector {
  private fieldRefs: number[] = [];
  private radioGroups = new Map<string, RadioGroup>();
  // Only set when appearance baking is OFF - then the viewer has to draw every value. With baking on
  // (the default) it stays absent, which is also what PDF/A requires.
  private needAppearances = false;
  // The built-in Helvetica every field's /DA (and a button's baked caption) refers to. Created on first
  // use and shared, so the /DR entry and the appearance streams point at ONE font object - and a document
  // of checkboxes alone never emits it.
  private helvNum?: number;
  // Same for ZapfDingbats, emitted only when a check box or radio button exists.
  private zadbNum?: number;
  // Set once a signature field exists; the catalog then needs /SigFlags.
  private hasSignature = false;
  // Bake every field's appearance (default). Off = emit no /AP and set /NeedAppearances, i.e. let the
  // viewer draw everything - what react-pdf/pdfkit always does, and what we did before this step.
  private bake = true;

  /** Turn appearance baking off (`renderToBytes(doc, { fieldAppearances: false })`). */
  setBakeAppearances(on: boolean): void {
    this.bake = on;
  }

  /** The size to draw a value at. A field may ask for `0` - the PDF convention for "auto-size"; we then
   *  fit the capitals comfortably inside the box, which is what a viewer's auto-size does. */
  private drawSize(style: FieldStyle, height: number, capHeight: number): number {
    if (style.fontSize > 0) return style.fontSize;
    const available = height - 2 * (2 + style.borderWidth);
    return Math.max(4, Math.min(12, (available * 0.7) / (capHeight || 0.7)));
  }

  /** Measure one line for the appearance generator. */
  private line(om: PDFObjectManager, text: string, size: number): FieldLine {
    return { text, width: om.getStringWidth(text, "Helvetica", size, NORMAL_STYLE) };
  }

  /** Bake a text field's value into an appearance stream; returns the XObject number. */
  private bakeText(node: FormFieldNode, om: PDFObjectManager): number {
    const f = node.field;
    if (f.kind !== "text") throw new Error("bakeText: not a text field");
    const { capHeight } = om.getFontDecoration("Helvetica", NORMAL_STYLE);
    const size = this.drawSize(node.style, node.height, capHeight);
    // A password field shows the mask, never the characters - the value still lives in /V.
    const value = f.password ? "•".repeat([...(f.value ?? "")].length) : (f.value ?? "");
    const innerWidth = Math.max(1, node.width - 2 * (2 + node.style.borderWidth));

    let lines: FieldLine[] = [];
    if (value) {
      const texts = wrapFieldValue(
        value,
        "Helvetica",
        size,
        NORMAL_STYLE,
        innerWidth,
        om,
        f.multiline ?? false,
      );
      lines = texts.map((t) => this.line(om, t, size));
    }
    const face = textFieldFace(
      node.width,
      node.height,
      node.style,
      lines,
      capHeight,
      size,
      "Helv",
      f.multiline ?? false,
      f.align,
    );
    return om.addFormXObject(
      `[0 0 ${num2(node.width)} ${num2(node.height)}]`,
      face,
      `/Font << /Helv ${this.helv(om)} 0 R >>`,
    );
  }

  /** Bake a choice field: a combo shows its current value on one line, a list box shows its options
   *  with the selected rows highlighted. */
  private bakeChoice(node: FormFieldNode, om: PDFObjectManager): number {
    const f = node.field;
    if (f.kind !== "choice") throw new Error("bakeChoice: not a choice");
    const { capHeight } = om.getFontDecoration("Helvetica", NORMAL_STYLE);
    const size = this.drawSize(node.style, node.height, capHeight);
    const shown = (v: string) => f.options.find((o) => o.value === v)?.label ?? v;
    const chosen = choiceSelection(f);
    const selected = new Set(chosen);

    let face: string;
    if (f.combo) {
      const current = chosen.length ? [this.line(om, shown(chosen[0]), size)] : [];
      face = textFieldFace(
        node.width,
        node.height,
        node.style,
        current,
        capHeight,
        size,
        "Helv",
        false,
        f.align,
      );
    } else {
      const rows = f.options.map((o) => ({
        ...this.line(om, o.label ?? o.value, size),
        selected: selected.has(o.value),
      }));
      face = listBoxFace(
        node.width,
        node.height,
        node.style,
        rows,
        capHeight,
        size,
        "Helv",
        f.align,
      );
    }
    return om.addFormXObject(
      `[0 0 ${num2(node.width)} ${num2(node.height)}]`,
      face,
      `/Font << /Helv ${this.helv(om)} 0 R >>`,
    );
  }

  get isEmpty(): boolean {
    return this.fieldRefs.length === 0;
  }

  private helv(om: PDFObjectManager): number {
    return (this.helvNum ??= om.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    ));
  }

  /**
   * ZapfDingbats, the font a check mark lives in. Needed even though we bake the appearance ourselves:
   * a viewer told to regenerate (`/NeedAppearances`, which filling a form sets) redraws a check box from
   * its `/DA`, and the conventional `/DA` for one names `/ZaDb`. Without the matching `/DR` entry the
   * viewer cannot resolve the font - poppler says "Unknown font tag 'ZaDb'" and draws no check at all.
   * No encoding: ZapfDingbats brings its own.
   */
  private zadb(om: PDFObjectManager): number {
    return (this.zadbNum ??= om.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>`,
    ));
  }

  /** Emit the widget object for one form-field IR node, register it as a field, and return its object
   *  number so the PageRenderer can add it to that page's /Annots. */
  addField(node: FormFieldNode, om: PDFObjectManager): number {
    if (node.field.kind === "radio") return this.addRadio(node, om);
    let dict: string;
    if (node.field.kind === "checkbox") {
      this.zadb(om); // its /DA names /ZaDb, so /DR has to carry it
      dict = buildCheckboxWidget(node, om);
    } else if (node.field.kind === "pushbutton") {
      dict = this.buildPushButtonWidget(node, om);
    } else if (node.field.kind === "signature") {
      dict = this.buildSignatureWidget(node, om);
    } else if (node.field.kind === "choice") {
      this.helv(om);
      dict = buildChoiceWidget(node, "Helv", om, this.bake ? this.bakeChoice(node, om) : undefined);
      // Only text and choice depend on the flag; the other kinds always carry a complete appearance,
      // so a document of checkboxes alone must not ask the viewer to redraw anything.
      if (!this.bake) this.needAppearances = true;
    } else {
      this.helv(om);
      dict = buildTextWidget(node, "Helv", om, this.bake ? this.bakeText(node, om) : undefined);
      if (!this.bake) this.needAppearances = true;
    }
    const objNum = om.addObject(dict);
    this.fieldRefs.push(objNum);
    return objNum;
  }

  /** A push button (/Btn, Pushbutton flag): no value, an optional action, and a baked caption. The
   *  caption is measured here (the appearance module stays free of font metrics) and drawn into an
   *  appearance stream that carries its own font resource. */
  private buildPushButtonWidget(node: FormFieldNode, om: PDFObjectManager): string {
    const f = node.field;
    if (f.kind !== "pushbutton") throw new Error("buildPushButtonWidget: not a push button");
    const { capHeight } = om.getFontDecoration("Helvetica", NORMAL_STYLE);
    // `fontSize: 0` means auto-size, here as everywhere: resolve it before measuring or drawing.
    const size = this.drawSize(node.style, node.height, capHeight);
    const width = om.getStringWidth(f.label, "Helvetica", size, NORMAL_STYLE);
    const fontNum = this.helv(om);
    const face = pushButtonFace(
      node.width,
      node.height,
      node.style,
      f.label,
      width,
      capHeight,
      "Helv",
      size,
    );
    const apRef = om.addFormXObject(
      `[0 0 ${num2(node.width)} ${num2(node.height)}]`,
      face,
      `/Font << /Helv ${fontNum} 0 R >>`,
    );

    const parts = [`/Type /Annot /Subtype /Widget /FT /Btn`, `/T ${om.pdfString(f.name)}`];
    if (f.tooltip !== undefined) parts.push(`/TU ${om.pdfString(f.tooltip)}`);
    parts.push(`/Ff ${FF_PUSHBUTTON | commonFlags(f)}`);
    parts.push(`/Rect ${rectOf(node)} /F ${annotFlags(f)}`);
    // /DA as well as the baked /AP: a viewer that REGENERATES the face (poppler does this for push
    // buttons; others do it while the button is pressed) needs the font + size + colour, or it draws the
    // box with no caption. With /DA it reproduces what we baked.
    parts.push(`/DA ${om.pdfString(`/Helv ${num2(size)} Tf ${pdfColor(node.style.color)} rg`)}`);
    parts.push(`/AP << /N ${apRef} 0 R >>`);
    if (f.action) parts.push(actionDict(f.action, om));
    // /MK /CA is the caption the viewer falls back to when IT regenerates the face (e.g. while pressed).
    return `<< ${parts.join(" ")}${boxChrome(node, `/CA ${om.pdfString(f.label)}`)} >>`;
  }

  /** A radio button: one KID widget of its group's shared field. The group field is reserved on first
   *  sight (and added to /Fields); each button adds itself to that field's /Kids. Returns the kid widget
   *  number, which goes into the PAGE /Annots (the parent field does not). */
  private addRadio(node: FormFieldNode, om: PDFObjectManager): number {
    const f = node.field;
    if (f.kind !== "radio") throw new Error("addRadio: not a radio");
    let g = this.radioGroups.get(f.group);
    if (!g) {
      g = { parentNum: om.addObject(""), kids: [], flags: 0 };
      this.radioGroups.set(f.group, g);
      this.fieldRefs.push(g.parentNum);
    }
    // The flags live on the shared field, so every button contributes: marking any one of them
    // required (or read-only) applies to the group.
    g.flags |= commonFlags(f);
    if (f.selected) g.selected = f.value;

    const bbox = `[0 0 ${num2(node.width)} ${num2(node.height)}]`;
    const onRef = om.addFormXObject(bbox, radioOn(node.width, node.height, node.style));
    const offRef = om.addFormXObject(bbox, radioOff(node.width, node.height, node.style));
    const as = f.selected ? f.value : "Off";
    this.zadb(om); // same as a check box: a regenerating viewer draws the dot from /DA + /DR
    const parts = [
      `/Type /Annot /Subtype /Widget /Parent ${g.parentNum} 0 R`,
      `/Rect ${rectOf(node)} /F ${annotFlags(f)}`,
      `/AP << /N << /${escName(f.value)} ${onRef} 0 R /Off ${offRef} 0 R >> >>`,
      `/AS /${escName(as)}`,
      `/DA ${om.pdfString(`/ZaDb 0 Tf ${pdfColor(node.style.color)} rg`)}`,
    ];
    const kidNum = om.addObject(`<< ${parts.join(" ")}${boxChrome(node)} >>`);
    g.kids.push(kidNum);
    return kidNum;
  }

  /** A signature field (/Sig): an EMPTY placeholder with a baked "sign here" face. No /V - an unsigned
   *  field has no value; a signing tool fills that in (and replaces this appearance) later. */
  private buildSignatureWidget(node: FormFieldNode, om: PDFObjectManager): string {
    const f = node.field;
    if (f.kind !== "signature") throw new Error("buildSignatureWidget: not a signature");
    this.hasSignature = true;
    const label = f.label ?? "";
    const { capHeight } = om.getFontDecoration("Helvetica", NORMAL_STYLE);
    const size = this.drawSize(node.style, node.height, capHeight);
    const labelWidth = label ? om.getStringWidth(label, "Helvetica", size, NORMAL_STYLE) : 0;
    const fontNum = this.helv(om);
    const apRef = om.addFormXObject(
      `[0 0 ${num2(node.width)} ${num2(node.height)}]`,
      signatureFace(node.width, node.height, node.style, label, labelWidth, "Helv", size),
      `/Font << /Helv ${fontNum} 0 R >>`,
    );

    const parts = [`/Type /Annot /Subtype /Widget /FT /Sig`, `/T ${om.pdfString(f.name)}`];
    if (f.tooltip !== undefined) parts.push(`/TU ${om.pdfString(f.tooltip)}`);
    if (commonFlags(f)) parts.push(`/Ff ${commonFlags(f)}`);
    parts.push(`/Rect ${rectOf(node)} /F ${annotFlags(f)}`);
    parts.push(`/AP << /N ${apRef} 0 R >>`);
    return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
  }

  finalize(om: PDFObjectManager): string {
    // Fill each reserved radio-group field now that all its buttons (Kids) are known.
    for (const [name, g] of this.radioGroups) {
      const kids = g.kids.map((k) => `${k} 0 R`).join(" ");
      const ff = FF_RADIO | FF_NO_TOGGLE_OFF | g.flags;
      om.replaceObject(
        g.parentNum,
        `<< /FT /Btn /Ff ${ff} /T ${om.pdfString(name)} /V /${escName(g.selected ?? "Off")} /Kids [${kids}] >>`,
      );
    }
    if (this.fieldRefs.length === 0) return "";
    const fields = this.fieldRefs.map((r) => `${r} 0 R`).join(" ");
    // /DR only lists the fonts a field's /DA actually references: /Helv for text, choice and button
    // captions, /ZaDb for the check mark of a box or radio button.
    const fonts = [
      this.helvNum ? `/Helv ${this.helvNum} 0 R` : "",
      this.zadbNum ? `/ZaDb ${this.zadbNum} 0 R` : "",
    ].filter(Boolean);
    const dr = fonts.length ? ` /DR << /Font << ${fonts.join(" ")} >> >>` : "";
    const na = this.needAppearances ? " /NeedAppearances true" : "";
    // /SigFlags 3 = SignaturesExist | AppendOnly: the document holds a signature field, and it must be
    // updated incrementally so an existing signature stays verifiable.
    const sig = this.hasSignature ? " /SigFlags 3" : "";
    return `/AcroForm << /Fields [${fields}]${dr}${na}${sig} >>`;
  }
}

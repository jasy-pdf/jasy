import type { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import type { FormFieldNode } from "../ir/display-list.ts";
import { NORMAL_STYLE, escPdf, num2, pdfColor } from "./pdf.ts";
import {
  checkboxOff,
  checkboxOn,
  pushButtonFace,
  radioOff,
  radioOn,
  signatureFace,
} from "./appearance.ts";
import type { ButtonAction } from "./field.ts";

// AcroForm field flags (/Ff), by 1-based bit position per the PDF spec.
const FF_READ_ONLY = 1 << 0; // bit 1
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

function rectOf(node: FormFieldNode): string {
  return `[${num2(node.x)} ${num2(node.y)} ${num2(node.x + node.width)} ${num2(node.y + node.height)}]`;
}

/** A text field (/Tx). Relies on /NeedAppearances (Step 1) - the viewer draws the value from /DA. */
function buildTextWidget(node: FormFieldNode, daFont: string): string {
  const f = node.field;
  if (f.kind !== "text") throw new Error("buildTextWidget: not a text field");
  const parts = [`/Type /Annot /Subtype /Widget /FT /Tx`, `/T (${escPdf(f.name)})`];
  if (f.value !== undefined) parts.push(`/V (${escPdf(f.value)})`);
  if (f.tooltip !== undefined) parts.push(`/TU (${escPdf(f.tooltip)})`);
  let flags = 0;
  if (f.readOnly) flags |= FF_READ_ONLY;
  if (f.multiline) flags |= FF_MULTILINE;
  if (f.password) flags |= FF_PASSWORD;
  if (flags) parts.push(`/Ff ${flags}`);
  if (f.maxLength !== undefined) parts.push(`/MaxLen ${f.maxLength}`);
  parts.push(`/Rect ${rectOf(node)} /F 4`);
  parts.push(`/DA (/${daFont} ${num2(node.style.fontSize)} Tf ${pdfColor(node.style.color)} rg)`);
  return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
}

/** A checkbox (/Btn). Bakes its own /AP appearance streams for the on + off states, so the check is
 *  visible everywhere (print / headless / PDF-A), not only in viewers that honour /NeedAppearances. */
function buildCheckboxWidget(node: FormFieldNode, om: PDFObjectManager): string {
  const f = node.field;
  if (f.kind !== "checkbox") throw new Error("buildCheckboxWidget: not a checkbox");
  const on = f.onValue ?? "Yes";
  const state = f.checked ? on : "Off";
  const bbox = `[0 0 ${num2(node.width)} ${num2(node.height)}]`;
  // One Form XObject per state; the widget's /AS picks which one shows.
  const onRef = om.addFormXObject(bbox, checkboxOn(node.width, node.height, node.style));
  const offRef = om.addFormXObject(bbox, checkboxOff(node.width, node.height, node.style));

  const parts = [`/Type /Annot /Subtype /Widget /FT /Btn`, `/T (${escPdf(f.name)})`];
  if (f.tooltip !== undefined) parts.push(`/TU (${escPdf(f.tooltip)})`);
  if (f.readOnly) parts.push(`/Ff ${FF_READ_ONLY}`);
  parts.push(`/V /${state} /AS /${state}`);
  parts.push(`/Rect ${rectOf(node)} /F 4`);
  parts.push(`/AP << /N << /${on} ${onRef} 0 R /Off ${offRef} 0 R >> >>`);
  return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
}

/** A choice field (/Ch): a dropdown (combo) or list box. Relies on /NeedAppearances (like text) so the
 *  viewer draws the selected value; Step 4 bakes its /AP alongside the text fields. */
function buildChoiceWidget(node: FormFieldNode, daFont: string): string {
  const f = node.field;
  if (f.kind !== "choice") throw new Error("buildChoiceWidget: not a choice");
  // /Opt: each entry is [ (export) (display) ], so a label can differ from the stored value.
  const opt = f.options
    .map((o) => `[(${escPdf(o.value)}) (${escPdf(o.label ?? o.value)})]`)
    .join(" ");
  const parts = [
    `/Type /Annot /Subtype /Widget /FT /Ch`,
    `/T (${escPdf(f.name)})`,
    `/Opt [${opt}]`,
  ];
  if (f.tooltip !== undefined) parts.push(`/TU (${escPdf(f.tooltip)})`);

  let flags = 0;
  if (f.readOnly) flags |= FF_READ_ONLY;
  if (f.combo) flags |= FF_COMBO | (f.editable ? FF_EDIT : 0);
  else if (f.multiSelect) flags |= FF_MULTI_SELECT;
  if (flags) parts.push(`/Ff ${flags}`);

  const indexOf = (v: string) => f.options.findIndex((o) => o.value === v);
  if (f.multiSelect && f.values && f.values.length) {
    parts.push(`/V [${f.values.map((v) => `(${escPdf(v)})`).join(" ")}]`);
    const idx = f.values.map(indexOf).filter((i) => i >= 0);
    if (idx.length) parts.push(`/I [${idx.join(" ")}]`);
  } else if (f.value !== undefined) {
    parts.push(`/V (${escPdf(f.value)})`);
    const i = indexOf(f.value);
    if (i >= 0) parts.push(`/I [${i}]`);
  }

  parts.push(`/Rect ${rectOf(node)} /F 4`);
  parts.push(`/DA (/${daFont} ${num2(node.style.fontSize)} Tf ${pdfColor(node.style.color)} rg)`);
  return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
}

/** The `/A` action a push button fires. Scripted actions are deliberately not offered. */
function actionDict(a: ButtonAction): string {
  switch (a.kind) {
    case "reset":
      return `/A << /S /ResetForm >>`;
    case "submit":
      // /Flags 4 = ExportFormat: post the field values as HTML form data rather than FDF, which is what
      // an ordinary web endpoint expects.
      return `/A << /S /SubmitForm /F << /FS /URL /F (${escPdf(a.url)}) >> /Flags 4 >>`;
    case "url":
      return `/A << /S /URI /URI (${escPdf(a.url)}) >>`;
  }
}

// One radio GROUP, collected across its individual buttons. `parentNum` is the shared /Btn field object
// (reserved up front, filled at finalize with the /Kids + the winning /V).
interface RadioGroup {
  parentNum: number;
  kids: number[];
  selected?: string;
  readOnly: boolean;
}

/**
 * Collects the document's form fields as pages render, then emits the catalog `/AcroForm` dictionary at
 * finalize. Mirrors `OutlineBuilder` / `DestRegistry`: a no-op returning "" when no field was placed, so
 * a document without a form stays byte-identical.
 */
export class AcroFormCollector {
  private fieldRefs: number[] = [];
  private radioGroups = new Map<string, RadioGroup>();
  // Text fields still lean on the viewer (Step 1); a later step bakes their /AP too and turns this off
  // (PDF/A forbids NeedAppearances). Checkboxes + radios already carry a baked /AP.
  private needAppearances = false;
  // The built-in Helvetica every field's /DA (and a button's baked caption) refers to. Created on first
  // use and shared, so the /DR entry and the appearance streams point at ONE font object - and a document
  // of checkboxes alone never emits it.
  private helvNum?: number;
  // Set once a signature field exists; the catalog then needs /SigFlags.
  private hasSignature = false;

  get isEmpty(): boolean {
    return this.fieldRefs.length === 0;
  }

  private helv(om: PDFObjectManager): number {
    return (this.helvNum ??= om.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    ));
  }

  /** Emit the widget object for one form-field IR node, register it as a field, and return its object
   *  number so the PageRenderer can add it to that page's /Annots. */
  addField(node: FormFieldNode, om: PDFObjectManager): number {
    if (node.field.kind === "radio") return this.addRadio(node, om);
    let dict: string;
    if (node.field.kind === "checkbox") {
      dict = buildCheckboxWidget(node, om);
    } else if (node.field.kind === "pushbutton") {
      dict = this.buildPushButtonWidget(node, om);
    } else if (node.field.kind === "signature") {
      dict = this.buildSignatureWidget(node, om);
    } else if (node.field.kind === "choice") {
      this.helv(om);
      dict = buildChoiceWidget(node, "Helv");
      this.needAppearances = true; // the viewer draws the selected value (baked in Step 4)
    } else {
      this.helv(om);
      dict = buildTextWidget(node, "Helv");
      this.needAppearances = true; // this text field needs the viewer to render its value
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
    const size = node.style.fontSize;
    const width = om.getStringWidth(f.label, "Helvetica", size, NORMAL_STYLE);
    const { capHeight } = om.getFontDecoration("Helvetica", NORMAL_STYLE);
    const fontNum = this.helv(om);
    const face = pushButtonFace(
      node.width,
      node.height,
      node.style,
      f.label,
      width,
      capHeight,
      "Helv",
    );
    const apRef = om.addFormXObject(
      `[0 0 ${num2(node.width)} ${num2(node.height)}]`,
      face,
      `/Font << /Helv ${fontNum} 0 R >>`,
    );

    const parts = [`/Type /Annot /Subtype /Widget /FT /Btn`, `/T (${escPdf(f.name)})`];
    if (f.tooltip !== undefined) parts.push(`/TU (${escPdf(f.tooltip)})`);
    parts.push(`/Ff ${FF_PUSHBUTTON | (f.readOnly ? FF_READ_ONLY : 0)}`);
    parts.push(`/Rect ${rectOf(node)} /F 4`);
    // /DA as well as the baked /AP: a viewer that REGENERATES the face (poppler does this for push
    // buttons; others do it while the button is pressed) needs the font + size + colour, or it draws the
    // box with no caption. With /DA it reproduces what we baked.
    parts.push(`/DA (/Helv ${num2(size)} Tf ${pdfColor(node.style.color)} rg)`);
    parts.push(`/AP << /N ${apRef} 0 R >>`);
    if (f.action) parts.push(actionDict(f.action));
    // /MK /CA is the caption the viewer falls back to when IT regenerates the face (e.g. while pressed).
    return `<< ${parts.join(" ")}${boxChrome(node, `/CA (${escPdf(f.label)})`)} >>`;
  }

  /** A radio button: one KID widget of its group's shared field. The group field is reserved on first
   *  sight (and added to /Fields); each button adds itself to that field's /Kids. Returns the kid widget
   *  number, which goes into the PAGE /Annots (the parent field does not). */
  private addRadio(node: FormFieldNode, om: PDFObjectManager): number {
    const f = node.field;
    if (f.kind !== "radio") throw new Error("addRadio: not a radio");
    let g = this.radioGroups.get(f.group);
    if (!g) {
      g = { parentNum: om.addObject(""), kids: [], readOnly: f.readOnly ?? false };
      this.radioGroups.set(f.group, g);
      this.fieldRefs.push(g.parentNum);
    }
    if (f.selected) g.selected = f.value;

    const bbox = `[0 0 ${num2(node.width)} ${num2(node.height)}]`;
    const onRef = om.addFormXObject(bbox, radioOn(node.width, node.height, node.style));
    const offRef = om.addFormXObject(bbox, radioOff(node.width, node.height, node.style));
    const as = f.selected ? f.value : "Off";
    const parts = [
      `/Type /Annot /Subtype /Widget /Parent ${g.parentNum} 0 R`,
      `/Rect ${rectOf(node)} /F 4`,
      `/AP << /N << /${f.value} ${onRef} 0 R /Off ${offRef} 0 R >> >>`,
      `/AS /${as}`,
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
    const labelWidth = label
      ? om.getStringWidth(label, "Helvetica", node.style.fontSize, NORMAL_STYLE)
      : 0;
    const fontNum = this.helv(om);
    const apRef = om.addFormXObject(
      `[0 0 ${num2(node.width)} ${num2(node.height)}]`,
      signatureFace(node.width, node.height, node.style, label, labelWidth, "Helv"),
      `/Font << /Helv ${fontNum} 0 R >>`,
    );

    const parts = [`/Type /Annot /Subtype /Widget /FT /Sig`, `/T (${escPdf(f.name)})`];
    if (f.tooltip !== undefined) parts.push(`/TU (${escPdf(f.tooltip)})`);
    if (f.readOnly) parts.push(`/Ff ${FF_READ_ONLY}`);
    parts.push(`/Rect ${rectOf(node)} /F 4`);
    parts.push(`/AP << /N ${apRef} 0 R >>`);
    return `<< ${parts.join(" ")}${boxChrome(node)} >>`;
  }

  finalize(om: PDFObjectManager): string {
    // Fill each reserved radio-group field now that all its buttons (Kids) are known.
    for (const [name, g] of this.radioGroups) {
      const kids = g.kids.map((k) => `${k} 0 R`).join(" ");
      const ff = FF_RADIO | FF_NO_TOGGLE_OFF | (g.readOnly ? FF_READ_ONLY : 0);
      om.replaceObject(
        g.parentNum,
        `<< /FT /Btn /Ff ${ff} /T (${escPdf(name)}) /V /${g.selected ?? "Off"} /Kids [${kids}] >>`,
      );
    }
    if (this.fieldRefs.length === 0) return "";
    const fields = this.fieldRefs.map((r) => `${r} 0 R`).join(" ");
    // /DR only when a field's /DA actually references the font (text, choice, button captions).
    const dr = this.helvNum ? ` /DR << /Font << /Helv ${this.helvNum} 0 R >> >>` : "";
    const na = this.needAppearances ? " /NeedAppearances true" : "";
    // /SigFlags 3 = SignaturesExist | AppendOnly: the document holds a signature field, and it must be
    // updated incrementally so an existing signature stays verifiable.
    const sig = this.hasSignature ? " /SigFlags 3" : "";
    return `/AcroForm << /Fields [${fields}]${dr}${na}${sig} >>`;
  }
}

import type { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import type { FormFieldNode } from "../ir/display-list.ts";
import { escPdf, num2, pdfColor } from "./pdf.ts";
import { checkboxOff, checkboxOn, radioOff, radioOn } from "./appearance.ts";

// AcroForm field flags (/Ff), by 1-based bit position per the PDF spec.
const FF_READ_ONLY = 1 << 0; // bit 1
const FF_MULTILINE = 1 << 12; // bit 13 (text)
const FF_PASSWORD = 1 << 13; // bit 14 (text)
const FF_NO_TOGGLE_OFF = 1 << 14; // bit 15 (button): clicking the selected radio does not clear it
const FF_RADIO = 1 << 15; // bit 16 (button): the group's kids are mutually exclusive

/** The `/MK` (appearance characteristics) + `/BS` (border style) shared by every widget: the box border
 *  colour + fill + width. Empty when the field has neither a border nor a background. */
function boxChrome(node: FormFieldNode): string {
  const { style } = node;
  const mk: string[] = [];
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

/**
 * Collects the document's form fields as pages render, then emits the catalog `/AcroForm` dictionary at
 * finalize. Mirrors `OutlineBuilder` / `DestRegistry`: a no-op returning "" when no field was placed, so
 * a document without a form stays byte-identical.
 */
// One radio GROUP, collected across its individual buttons. `parentNum` is the shared /Btn field object
// (reserved up front, filled at finalize with the /Kids + the winning /V).
interface RadioGroup {
  parentNum: number;
  kids: number[];
  selected?: string;
  readOnly: boolean;
}

export class AcroFormCollector {
  private fieldRefs: number[] = [];
  private radioGroups = new Map<string, RadioGroup>();
  // Text fields still lean on the viewer (Step 1); a later step bakes their /AP too and turns this off
  // (PDF/A forbids NeedAppearances). Checkboxes + radios already carry a baked /AP.
  private needAppearances = false;

  get isEmpty(): boolean {
    return this.fieldRefs.length === 0;
  }

  /** Emit the widget object for one form-field IR node, register it as a field, and return its object
   *  number so the PageRenderer can add it to that page's /Annots. */
  addField(node: FormFieldNode, om: PDFObjectManager): number {
    if (node.field.kind === "radio") return this.addRadio(node, om);
    let dict: string;
    if (node.field.kind === "checkbox") {
      dict = buildCheckboxWidget(node, om);
    } else {
      dict = buildTextWidget(node, "Helv");
      this.needAppearances = true; // this text field needs the viewer to render its value
    }
    const objNum = om.addObject(dict);
    this.fieldRefs.push(objNum);
    return objNum;
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
    // The default resources the text fields' /DA references.
    const helv = om.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    );
    const fields = this.fieldRefs.map((r) => `${r} 0 R`).join(" ");
    const na = this.needAppearances ? " /NeedAppearances true" : "";
    return `/AcroForm << /Fields [${fields}] /DR << /Font << /Helv ${helv} 0 R >> >>${na} >>`;
  }
}

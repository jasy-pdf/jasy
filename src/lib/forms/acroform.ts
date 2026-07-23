import type { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import type { Color } from "../common/color.ts";
import type { FormFieldNode } from "../ir/display-list.ts";

// A PDF literal-string escape (same rule the rest of the writer uses).
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n2 = (n: number) => Number(n.toFixed(2));
// A colour as PDF operands "r g b" in 0..1 (for /DA); Color stores 0..255.
const rgb = (c: Color) =>
  c
    .toArray()
    .map((v) => (v / 255).toFixed(3))
    .join(" ");

// AcroForm text-field flags (/Ff), 1-based bit positions per the PDF spec.
const FF_READ_ONLY = 1 << 0; // bit 1
const FF_MULTILINE = 1 << 12; // bit 13
const FF_PASSWORD = 1 << 13; // bit 14

/**
 * Builds the widget-annotation object for one form field (a merged field + widget dict: the object is
 * BOTH the /AcroForm field and the page /Annot). The rect is already Y-flipped into page space by the
 * time it gets here. Step 1 handles the text field; other kinds add a branch.
 *
 * `daFont` is the resource name of the default-appearance font in the AcroForm /DR (see the collector).
 * With `/NeedAppearances` set (Step 1), the viewer draws the value from this /DA; a later step bakes an
 * explicit /AP so it is visible in print / headless / PDF-A too.
 */
function buildWidgetDict(node: FormFieldNode, daFont: string): string {
  const { field, style } = node;
  const rect = `[${n2(node.x)} ${n2(node.y)} ${n2(node.x + node.width)} ${n2(node.y + node.height)}]`;
  const parts: string[] = [`/Type /Annot /Subtype /Widget`];

  if (field.kind === "text") {
    parts.push(`/FT /Tx`);
    parts.push(`/T (${esc(field.name)})`);
    if (field.value !== undefined) parts.push(`/V (${esc(field.value)})`);
    if (field.tooltip !== undefined) parts.push(`/TU (${esc(field.tooltip)})`);
    let flags = 0;
    if (field.readOnly) flags |= FF_READ_ONLY;
    if (field.multiline) flags |= FF_MULTILINE;
    if (field.password) flags |= FF_PASSWORD;
    if (flags) parts.push(`/Ff ${flags}`);
    if (field.maxLength !== undefined) parts.push(`/MaxLen ${field.maxLength}`);
  }

  // /F 4 = the Print flag, so the field is not screen-only. /DA is the default appearance the viewer
  // uses to draw the value (font resource + size + colour).
  parts.push(`/Rect ${rect}`);
  parts.push(`/F 4`);
  parts.push(`/DA (/${daFont} ${n2(style.fontSize)} Tf ${rgb(style.color)} rg)`);

  // /MK gives the box its border (/BC) and background (/BG) colours; /BS its border width + style.
  const mk: string[] = [];
  if (style.border) mk.push(`/BC [${rgb(style.border)}]`);
  if (style.background) mk.push(`/BG [${rgb(style.background)}]`);
  if (mk.length) parts.push(`/MK << ${mk.join(" ")} >>`);
  if (style.border && style.borderWidth > 0) {
    parts.push(`/BS << /W ${n2(style.borderWidth)} /S /S >>`);
  }

  return `<< ${parts.join(" ")} >>`;
}

/**
 * Collects the document's form fields as pages render, then emits the catalog `/AcroForm` dictionary at
 * finalize. Mirrors `OutlineBuilder` / `DestRegistry`: a no-op returning "" when no field was placed, so
 * a document without a form stays byte-identical.
 */
export class AcroFormCollector {
  private fieldRefs: number[] = [];
  // Step 1 relies on the viewer to render field appearances from /DA. A later step generates /AP and
  // flips this off (PDF/A forbids NeedAppearances).
  private needAppearances = true;

  get isEmpty(): boolean {
    return this.fieldRefs.length === 0;
  }

  /** Emit the widget object for one form-field IR node, register it as a field, and return its object
   *  number so the PageRenderer can add it to that page's /Annots. */
  addField(node: FormFieldNode, om: PDFObjectManager): number {
    const objNum = om.addObject(buildWidgetDict(node, "Helv"));
    this.fieldRefs.push(objNum);
    return objNum;
  }

  finalize(om: PDFObjectManager): string {
    if (this.fieldRefs.length === 0) return "";
    // The default resources the fields' /DA references: a Helvetica the viewer can use to lay out text.
    const helv = om.addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`,
    );
    const fields = this.fieldRefs.map((r) => `${r} 0 R`).join(" ");
    const na = this.needAppearances ? " /NeedAppearances true" : "";
    return `/AcroForm << /Fields [${fields}] /DR << /Font << /Helv ${helv} 0 R >> >>${na} >>`;
  }
}

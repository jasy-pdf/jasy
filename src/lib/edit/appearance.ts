import { PDFObjectManager, FontStyle } from "../utils/pdf-object-manager.ts";
import {
  checkboxOff,
  checkboxOn,
  listBoxFace,
  radioOff,
  radioOn,
  textFieldFace,
  wrapFieldValue,
  type FieldLine,
} from "../forms/appearance.ts";
import type { FieldAlign, FieldStyle } from "../forms/field.ts";
import { Color } from "../common/color.ts";
import type { PdfDocument } from "./document.ts";
import type { ReadField } from "./acroform-reader.ts";
import { get, isDict, isString, numberOf, type PdfObject } from "./objects.ts";
import { latin1FromBytes } from "../utils/bytes.ts";

/**
 * Re-drawing a field's appearance after its value changed.
 *
 * A widget's appearance is a picture of its value. Change the value and the picture is wrong - which is
 * why filling used to DROP it and ask the viewer to redraw (`/NeedAppearances`). That works, but it hands
 * control of how the value looks to whatever program opens the file, and it leaves the field invisible in
 * anything that does not honour the flag. Baking it is what jasy does when it CREATES a field; there is
 * no reason the edit side should be different.
 *
 * The face builders in `forms/appearance.ts` need nothing from the writer - plain numbers, a style and
 * pre-measured lines - so the only pieces to bring are the font metrics and the widget's own style, and
 * the latter is readable straight out of the file: `/DA` for size and colour, `/MK` for the border and
 * background, `/Q` for alignment, `/Ff` for multiline.
 */

const FF_MULTILINE = 1 << 12;
const FF_PASSWORD = 1 << 13;

/** Font metrics for measuring, with the standard 14 registered. Built once and reused. */
let metrics: PDFObjectManager | undefined;
function fontMetrics(): PDFObjectManager {
  if (!metrics) {
    metrics = new PDFObjectManager();
    metrics.registerFont("Helvetica", FontStyle.Normal, "Helvetica");
  }
  return metrics;
}

/** `[r g b]` in 0..1, as `/MK` writes colours. An empty array means "none". */
function colorOf(raw: PdfObject | undefined): Color | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const n = raw.map((x) => (typeof x === "number" ? x : 0));
  if (n.length === 1) return new Color(n[0] * 255, n[0] * 255, n[0] * 255); // grey
  if (n.length >= 3) return new Color(n[0] * 255, n[1] * 255, n[2] * 255);
  return undefined;
}

/**
 * The bits of `/DA` we need: the font size and the fill colour.
 *
 * `/DA` is a content-stream fragment, not a dictionary - `"/Helv 12 Tf 0 0 0 rg"`. Size `0` is the PDF
 * convention for "auto, fit the box", which is what a viewer would do; we resolve it the same way the
 * writer does when it bakes.
 */
function fromDA(da: string | undefined): { size: number; color: Color } {
  let size = 0;
  let color = new Color(0, 0, 0);
  if (da) {
    const tf = /(-?[\d.]+)\s+Tf/.exec(da);
    if (tf) size = Number(tf[1]);
    const rg = /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+rg/.exec(da);
    const g = /(-?[\d.]+)\s+g\b/.exec(da);
    if (rg) color = new Color(Number(rg[1]) * 255, Number(rg[2]) * 255, Number(rg[3]) * 255);
    else if (g) color = new Color(Number(g[1]) * 255, Number(g[1]) * 255, Number(g[1]) * 255);
  }
  return { size, color };
}

/** What the widget says about how it should look. Missing entries fall back to the sober defaults. */
export interface WidgetLook {
  width: number;
  height: number;
  style: FieldStyle;
  align: FieldAlign;
  multiline: boolean;
  password: boolean;
}

export function readLook(
  doc: PdfDocument,
  widget: PdfObject | undefined,
  field: ReadField,
): WidgetLook | undefined {
  const rect = doc.lookup(widget, "Rect");
  if (!Array.isArray(rect) || rect.length < 4) return undefined;
  const n = rect.map((x) => (typeof x === "number" ? x : NaN));
  if (n.some(Number.isNaN)) return undefined;
  const width = Math.abs(n[2] - n[0]);
  const height = Math.abs(n[3] - n[1]);

  // /DA may be on the widget, the field, or the form - it is inheritable.
  const daOf = (o: PdfObject | undefined) => {
    const v = doc.lookup(o, "DA");
    return isString(v) ? latin1FromBytes(v.bytes) : undefined;
  };
  const acro = doc.lookup(doc.catalog, "AcroForm");
  const da =
    daOf(widget) ??
    (field.objNum !== undefined ? daOf(doc.getObject(field.objNum)) : undefined) ??
    daOf(acro);
  const { size, color } = fromDA(da);

  const mk = doc.resolve(get(widget, "MK"));
  const border = isDict(mk) ? colorOf(doc.lookup(mk, "BC")) : undefined;
  const background = isDict(mk) ? colorOf(doc.lookup(mk, "BG")) : undefined;
  const bs = doc.resolve(get(widget, "BS"));
  const borderWidth = border ? (numberOf(isDict(bs) ? doc.lookup(bs, "W") : undefined) ?? 1) : 0;

  const q = numberOf(doc.lookup(widget, "Q")) ?? 0;
  return {
    width,
    height,
    style: { border, background, color, fontSize: size, borderWidth },
    align: q === 1 ? "center" : q === 2 ? "right" : "left",
    multiline: (field.flags & FF_MULTILINE) !== 0,
    password: (field.flags & FF_PASSWORD) !== 0,
  };
}

/** The auto-size a viewer would pick: fit the cap height into the box, clamped to something readable. */
function drawSize(look: WidgetLook, capHeight: number): number {
  if (look.style.fontSize > 0) return look.style.fontSize;
  const inner = look.height - 2 * (2 + look.style.borderWidth);
  return Math.max(4, Math.min(12, inner / (capHeight * 1.6)));
}

/**
 * The content stream for a text or choice field showing `value`, and the BBox it is drawn in.
 * Returns `undefined` for a kind we do not draw (a button keeps its own state pictures).
 */
export function bakeAppearance(
  look: WidgetLook,
  field: ReadField,
  value: string | undefined,
  values: string[] | undefined,
): { content: string; bbox: [number, number, number, number] } | undefined {
  if (field.type !== "Tx" && field.type !== "Ch") return undefined;
  const om = fontMetrics();
  const { capHeight } = om.getFontDecoration("Helvetica", FontStyle.Normal);
  const size = drawSize(look, capHeight);
  const innerWidth = Math.max(1, look.width - 2 * (2 + look.style.borderWidth));
  const measure = (t: string): FieldLine => ({
    text: t,
    width: om.getStringWidth(t, "Helvetica", size, FontStyle.Normal),
  });

  let content: string;
  if (field.type === "Ch" && field.options && look.height > size * 2) {
    // A list box draws every option, with the selected ones highlighted.
    const chosen = new Set(values ?? (value !== undefined ? [value] : []));
    const rows = field.options.map((o) => ({
      ...measure(o.label),
      selected: chosen.has(o.value),
    }));
    content = listBoxFace(look.width, look.height, look.style, rows, capHeight, size, "Helv");
  } else {
    const shown = look.password ? "•".repeat([...(value ?? "")].length) : (value ?? "");
    const lines = shown
      ? wrapFieldValue(
          shown,
          "Helvetica",
          size,
          FontStyle.Normal,
          innerWidth,
          om,
          look.multiline,
        ).map(measure)
      : [];
    content = textFieldFace(
      look.width,
      look.height,
      look.style,
      lines,
      capHeight,
      size,
      "Helv",
      look.multiline,
      look.align,
    );
  }
  return { content, bbox: [0, 0, look.width, look.height] };
}

/** The `/DR` a regenerated appearance refers to: our own Helvetica, added when the form has none. */
export const HELV_FONT =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

/** True when the form's `/DR /Font` already offers a usable `/Helv`. */
export function hasHelv(doc: PdfDocument): boolean {
  const dr = doc.lookup(doc.lookup(doc.catalog, "AcroForm"), "DR");
  const fonts = doc.lookup(dr, "Font");
  return isDict(fonts) && fonts.map.has("Helv");
}

/**
 * The two state pictures a check box or radio button needs, for a widget that ships none at all.
 *
 * A button's `/AP /N` is a dictionary of STATES, not a picture of a value, so an existing one stays
 * valid however often the value changes - this is only for the producers that write none (PDFKit,
 * react-pdf) and leave every box empty until a viewer redraws it. `on` is the export name the widget
 * switches to.
 */
export function bakeButtonStates(
  look: WidgetLook,
  on: string,
  radio: boolean,
): { on: string; off: string; bbox: [number, number, number, number]; state: string } {
  const w = look.width;
  const h = look.height;
  return {
    on: radio ? radioOn(w, h, look.style) : checkboxOn(w, h, look.style),
    off: radio ? radioOff(w, h, look.style) : checkboxOff(w, h, look.style),
    bbox: [0, 0, w, h],
    state: on,
  };
}

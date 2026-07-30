import type { FieldAlign, FieldStyle } from "./field.ts";
import { escPdf, num2, pdfColor } from "./pdf.ts";
import { wrapStringIntoLines } from "../text/line-breaker.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import type { FontStyle } from "../utils/pdf-object-manager.ts";

// Appearance streams (/AP): the actual drawn content of a field's box, in the field's OWN coordinate
// space (bottom-left origin, [0 0 w h]). Shared between CREATE (bake the field's look now) and, later,
// FILL-existing (regenerate a field's look after setting its value). This is why it is its own module.

/** Draw the field box: background fill + border stroke, inset so the stroke stays inside the BBox. */
function box(w: number, h: number, style: FieldStyle): string {
  const ops: string[] = [];
  if (style.background) ops.push(`${pdfColor(style.background)} rg 0 0 ${num2(w)} ${num2(h)} re f`);
  if (style.border && style.borderWidth > 0) {
    const bw = style.borderWidth;
    const i = bw / 2;
    ops.push(
      `${pdfColor(style.border)} RG ${num2(bw)} w ${num2(i)} ${num2(i)} ${num2(w - bw)} ${num2(h - bw)} re S`,
    );
  }
  return ops.join("\n");
}

/** The unchecked appearance: just the box. */
export function checkboxOff(w: number, h: number, style: FieldStyle): string {
  return box(w, h, style);
}

/** The checked appearance: the box plus a vector checkmark (font-free, so it renders everywhere). */
export function checkboxOn(w: number, h: number, style: FieldStyle): string {
  const lw = Math.max(1, Math.min(w, h) * 0.12);
  // A tick: down-stroke to the low point, then up-stroke to the high point. Round caps/joins (2 J / 1 j).
  const p = (fx: number, fy: number) => `${num2(fx * w)} ${num2(fy * h)}`;
  const tick =
    `${pdfColor(style.color)} RG ${num2(lw)} w 2 J 1 j ` +
    `${p(0.22, 0.52)} m ${p(0.42, 0.3)} l ${p(0.78, 0.74)} l S`;
  return `${box(w, h, style)}\n${tick}`;
}

// A circle path (4 cubic-bezier arcs, kappa = 0.5523) around (cx, cy) with radius r. Not stroked/filled -
// the caller appends `S` (stroke) or `f` (fill).
function circlePath(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  const n = num2;
  return (
    `${n(cx + r)} ${n(cy)} m ` +
    `${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c ` +
    `${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c ` +
    `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c ` +
    `${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`
  );
}

/** The ring of a radio button (the outline), in [0 0 w h]. */
function radioRing(w: number, h: number, style: FieldStyle): string {
  const r = Math.min(w, h) / 2;
  const bw = style.borderWidth > 0 ? style.borderWidth : 1;
  const ops: string[] = [];
  if (style.background)
    ops.push(`${pdfColor(style.background)} rg ${circlePath(w / 2, h / 2, r)} f`);
  const stroke = style.border ?? style.color;
  ops.push(`${pdfColor(stroke)} RG ${num2(bw)} w ${circlePath(w / 2, h / 2, r - bw / 2)} S`);
  return ops.join("\n");
}

/** An unselected radio button: just the ring. */
export function radioOff(w: number, h: number, style: FieldStyle): string {
  return radioRing(w, h, style);
}

/** A selected radio button: the ring plus a filled inner dot. */
export function radioOn(w: number, h: number, style: FieldStyle): string {
  const r = Math.min(w, h) / 2;
  const dot = `${pdfColor(style.color)} rg ${circlePath(w / 2, h / 2, r * 0.45)} f`;
  return `${radioRing(w, h, style)}\n${dot}`;
}

/**
 * A push button's face: the box plus its caption, centred. The caller measures the caption (this module
 * stays free of font metrics and the writer) and passes `captionWidth` in points and `capHeight` as an em
 * fraction; the baseline is placed so the CAPITALS sit optically centred, not the em box. `fontRes` is
 * the font's resource name inside the appearance stream's own /Resources.
 */
export function pushButtonFace(
  w: number,
  h: number,
  style: FieldStyle,
  caption: string,
  captionWidth: number,
  capHeight: number,
  fontRes: string,
  size: number,
): string {
  // Baseline placed so the CAPITALS sit optically centred in the box, not the em square.
  const y = (h - capHeight * size) / 2;
  const caption_ = caption ? centredText(w, h, style, caption, captionWidth, y, fontRes, size) : "";
  return `${box(w, h, style)}\n${caption_}`;
}

/** One centred, clipped text run inside a field box. Clipping means an over-long caption is cut at the
 *  border instead of bleeding across the page. Shared by the push button and the signature placeholder. */
function centredText(
  w: number,
  h: number,
  style: FieldStyle,
  text: string,
  textWidth: number,
  baselineY: number,
  fontRes: string,
  size: number,
): string {
  return (
    `q 0 0 ${num2(w)} ${num2(h)} re W n ` +
    `BT /${fontRes} ${num2(size)} Tf ${pdfColor(style.color)} rg ` +
    `${num2((w - textWidth) / 2)} ${num2(baselineY)} Td (${escPdf(text)}) Tj ET Q`
  );
}

/**
 * An EMPTY signature field: the box, a signing rule across the lower third, and an optional hint centred
 * just above it. This is the placeholder look - once someone actually signs, the signing tool replaces
 * this appearance with its own.
 */
export function signatureFace(
  w: number,
  h: number,
  style: FieldStyle,
  label: string,
  labelWidth: number,
  fontRes: string,
  size: number,
): string {
  const ruleY = h * 0.3;
  const inset = w * 0.08;
  const stroke = style.border ?? style.color;
  const rule =
    `${pdfColor(stroke)} RG ${num2(Math.max(0.5, style.borderWidth * 0.75))} w ` +
    `${num2(inset)} ${num2(ruleY)} m ${num2(w - inset)} ${num2(ruleY)} l S`;
  const hint = label ? centredText(w, h, style, label, labelWidth, ruleY + 6, fontRes, size) : "";
  return `${box(w, h, style)}\n${rule}\n${hint}`;
}

// Horizontal padding inside a field box, on top of the border - the same small inset Acrobat leaves so
// the value does not touch the frame.
const FIELD_PAD = 2;
// A list box highlights its selected rows. Viewers each pick their own colour; once we bake the
// appearance WE decide, and this light blue is the familiar selection tint.
const SELECTION_TINT = "0.60 0.75 0.95";

/** One pre-measured line of field text. The caller owns wrapping + measuring, so this module stays free
 *  of font metrics (and can be reused verbatim when filling an existing PDF). */
/**
 * A field value split into the lines it is DRAWN as.
 *
 * An explicit line break in the value is a line break, and only then does width wrapping apply within
 * each paragraph. Wrapping on width alone ran the paragraphs together - a multi-line field showed
 * "first lineSecond line" - and it did so on BOTH paths, creating a field and filling one, which is why
 * this lives here rather than in either of them.
 */
export function wrapFieldValue(
  value: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: FontStyle,
  maxWidth: number,
  metrics: FontMetrics,
  multiline: boolean,
): string[] {
  if (!multiline) return [value.replace(/\r\n?|\n/g, " ")];
  // CR, LF and CRLF all mean one break (PDF 7.3.4.2 says the same about a literal string).
  return value
    .split(/\r\n?|\n/)
    .flatMap((para) =>
      para === ""
        ? [""]
        : wrapStringIntoLines(para, fontFamily, fontSize, fontStyle, maxWidth, metrics),
    );
}

export interface FieldLine {
  text: string;
  width: number;
  /** List box only: draw a selection highlight behind this row. */
  selected?: boolean;
}

/** Where a line of `width` starts, given the box, its padding and the requested alignment. */
function alignX(boxWidth: number, pad: number, width: number, align: FieldAlign = "left"): number {
  if (align === "center") return (boxWidth - width) / 2;
  if (align === "right") return boxWidth - pad - width;
  return pad;
}

/**
 * `BT … ET` for absolutely-placed lines. `Tm` (not `Td`) so each line's position is independent.
 *
 * Field text is drawn UNKERNED (a plain `Tj`, never a `TJ` array), even though ordinary document text
 * kerns by default. That is deliberate: the moment someone clicks into a field, the viewer regenerates
 * this appearance from `/DA` - and viewers do not kern field text. Kerning here would make the value
 * visibly shift on first click. The measurement matches: `getStringWidth` is the plain glyph sum, so
 * measured still equals drawn.
 */
function textBlock(
  lines: Array<{ text: string; x: number; y: number }>,
  style: FieldStyle,
  size: number,
  fontRes: string,
): string {
  const runs = lines
    .map((l) => `1 0 0 1 ${num2(l.x)} ${num2(l.y)} Tm (${escPdf(l.text)}) Tj`)
    .join("\n");
  return `BT /${fontRes} ${num2(size)} Tf ${pdfColor(style.color)} rg\n${runs}\nET`;
}

/** Everything a field draws is clipped to its own box, so a long value is cut at the frame rather than
 *  bleeding across the page. */
function clipped(w: number, h: number, ops: string): string {
  return `q 0 0 ${num2(w)} ${num2(h)} re W n\n${ops}\nQ`;
}

/**
 * A text field's value, baked. `lines` is already wrapped (one entry for a single-line field). A
 * single line sits optically centred; a multi-line field stacks from the top, both measured off the
 * font's cap height rather than a guessed ratio.
 */
export function textFieldFace(
  w: number,
  h: number,
  style: FieldStyle,
  lines: FieldLine[],
  capHeight: number,
  size: number,
  fontRes: string,
  multiline: boolean,
  align: FieldAlign = "left",
): string {
  const face = box(w, h, style);
  if (lines.length === 0) return face;
  const pad = FIELD_PAD + style.borderWidth;
  const lineHeight = size * 1.15;
  const placed = lines.map((l, i) => ({
    text: l.text,
    x: alignX(w, pad, l.width, align),
    // Multi-line: the first line's capitals start one cap-height below the top inset, then step down.
    // Single line: centre the capitals in the box.
    y: multiline ? h - pad - capHeight * size - i * lineHeight : (h - capHeight * size) / 2,
  }));
  return `${face}\n${clipped(w, h, textBlock(placed, style, size, fontRes))}`;
}

/**
 * A list box, baked: the visible options stacked from the top, with a highlight behind the selected
 * ones. A combo box (dropdown) uses `textFieldFace` instead - it shows only its current value.
 */
export function listBoxFace(
  w: number,
  h: number,
  style: FieldStyle,
  lines: FieldLine[],
  capHeight: number,
  size: number,
  fontRes: string,
  align: FieldAlign = "left",
): string {
  const pad = FIELD_PAD + style.borderWidth;
  const lineHeight = size * 1.15;
  const rowTop = (i: number) => h - pad - (i + 1) * lineHeight;
  // Highlights first, so the text sits on top of them.
  const highlights = lines
    .map((l, i) =>
      l.selected
        ? `${SELECTION_TINT} rg ${num2(pad / 2)} ${num2(rowTop(i))} ${num2(w - pad)} ${num2(lineHeight)} re f`
        : "",
    )
    .filter(Boolean)
    .join("\n");
  const placed = lines.map((l, i) => ({
    text: l.text,
    x: alignX(w, pad, l.width, align),
    // Baseline inside the row: lift it off the row bottom by the slack under the capitals.
    y: rowTop(i) + (lineHeight - capHeight * size) / 2,
  }));
  const inner = [highlights, textBlock(placed, style, size, fontRes)].filter(Boolean).join("\n");
  return `${box(w, h, style)}\n${clipped(w, h, inner)}`;
}

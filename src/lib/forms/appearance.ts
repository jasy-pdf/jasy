import type { FieldStyle } from "./field.ts";
import { num2, pdfColor } from "./pdf.ts";

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

import type { Color } from "../common/color.ts";

// Small PDF-writer helpers shared across the forms module (widget dicts + appearance streams).

/** Escape a PDF literal string: backslash first, then the string delimiters. */
export const escPdf = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Trim a number to 2 decimals (PDF operands). */
export const num2 = (n: number) => Number(n.toFixed(2));

/** A colour as PDF operands "r g b" in 0..1 (Color stores 0..255). */
export const pdfColor = (c: Color) =>
  c
    .toArray()
    .map((v) => (v / 255).toFixed(3))
    .join(" ");

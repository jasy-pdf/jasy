import type { Color } from "../common/color.ts";
import type { FontStyle } from "../utils/pdf-object-manager.ts";

// Small PDF-writer helpers shared across the forms module (widget dicts + appearance streams).
//
// Note: everything under `forms/` imports the object manager TYPE-ONLY. Keeping the runtime dependency
// one-way (the writer owns a collector, never the reverse) avoids an ESM import cycle.

/** The regular face, for measuring a field's built-in Helvetica. `FontStyle` is a string enum, so this
 *  is its exact value - asserted here once instead of importing the enum (which would be a runtime
 *  import of the writer, see above). */
export const NORMAL_STYLE = "normal" as FontStyle;

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

/**
 * Escape a PDF **Name** token (`/Yes`, `/Off`, a checkbox's export value). A Name may only hold the
 * regular characters; whitespace, the delimiters `()<>[]{}/%` and `#` itself must be written `#XX` by
 * BYTE. Without this, an export value like `"Ja / Nein"` would break the dictionary it sits in.
 * Literal strings - `(text)` - use `escPdf` instead; the two escapes are not interchangeable.
 */
export const escName = (s: string): string =>
  Array.from(new TextEncoder().encode(s))
    .map((b) =>
      b >= 0x21 && b <= 0x7e && !"()<>[]{}/%#".includes(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : "#" + b.toString(16).padStart(2, "0").toUpperCase(),
    )
    .join("");

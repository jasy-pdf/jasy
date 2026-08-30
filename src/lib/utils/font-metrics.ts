import type { FontStyle } from "./pdf-object-manager.ts";
import type { FontVerticals } from "../text/line-metrics.ts";
import type { FontDecoration } from "../text/text-decoration.ts";

/**
 * Read-only font measurement - the slice of the object manager that the layout pass
 * needs. Keeping layout (and, later, fragmentation) behind this interface means those
 * passes depend only on metrics, never on the PDF byte writer. `PDFObjectManager`
 * implements it today; a standalone metrics service can replace it later without
 * touching layout code.
 */
export interface FontMetrics {
  getStringWidth(text: string, fontFamily: string, fontSize: number, fontStyle: FontStyle): number;

  getCharWidth(
    char: string,
    fontSize: number,
    fullFontName?: string,
    fontName?: string,
    fontStyle?: FontStyle,
  ): number;

  /** Ascent / descent / lineGap of a face, in em fractions - the vertical counterpart of the widths
   *  above. Drives the line box and the baseline (see `text/line-metrics.ts`). */
  getFontVerticals(fontFamily: string, fontStyle: FontStyle): FontVerticals;

  /** Underline / strikethrough geometry of a face, in em fractions. GLYPH metrics, deliberately kept
   *  apart from the LINE metrics above (see `text/text-decoration.ts`). */
  getFontDecoration(fontFamily: string, fontStyle: FontStyle): FontDecoration;

  /** Whether kerning is on for this document. `runAdvance` reads it so a measured advance matches the
   *  drawn one (the backend emits a `TJ` under the same flag). */
  readonly kerningEnabled: boolean;

  /** Per-adjacent-pair kerning of `text`, in em/1000 (negative tightens); length `codePoints - 1`,
   *  zero next to a space. Only meaningful when `kerningEnabled`. */
  getKernPairs(text: string, fontFamily: string, fontStyle: FontStyle): number[];

  /** Whether this family can draw the code point at all - what picks a face out of a fallback stack. */
  hasGlyph(codePoint: number, fontFamily: string, fontStyle: FontStyle): boolean;

  /** Whether the document draws this code point as colour emoji rather than from the text font - it
   *  is missing from that font on purpose, so glyph coverage must not touch it. */
  rendersAsEmoji?(codePoint: number, fontFamily: string, fontStyle: FontStyle): boolean;

  /** Told when a code point had to be removed because no font could draw it. Optional: a metrics
   *  object used only for measuring (a test double) has nothing to report to. */
  reportMissingGlyph?(codePoints: number[]): void;

  /** How many glyphs the run will DRAW, when a ligature made that differ from its code-point count.
   *  Absent or `undefined` means "the same", which is every Latin run. */
  shapedGlyphCount?(text: string, fontFamily?: string, fontStyle?: FontStyle): number | undefined;
}

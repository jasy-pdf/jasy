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
}

import type { FontStyle } from "./pdf-object-manager";

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
}

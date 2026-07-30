import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "node:url";
import type { FontFamily } from "@jasy/pdf";

// The bundled fonts live at the package root (assets/fonts), resolvable from both src/ and dist/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.resolve(__dirname, "..", "assets", "fonts");
const read = (file: string) => fs.readFileSync(path.join(FONT_DIR, file));

const family = (base: string): FontFamily => ({
  normal: read(`${base}-Regular.ttf`),
  bold: read(`${base}-Bold.ttf`),
  italic: read(`${base}-Italic.ttf`),
  boldItalic: read(`${base}-BoldItalic.ttf`),
});

/**
 * The bundled Liberation families, keyed by the standard-14 names they substitute, ready for
 * `renderPdf(doc, { fonts })`. Registering them under "Helvetica"/"Times"/"Courier" makes those
 * names render as embedded (PDF/A-valid) metric-compatible look-alikes instead of the
 * non-embeddable standard-14.
 */
export function bundledFonts(): Record<string, FontFamily> {
  return {
    Helvetica: family("LiberationSans"),
    Times: family("LiberationSerif"),
    Courier: family("LiberationMono"),
  };
}

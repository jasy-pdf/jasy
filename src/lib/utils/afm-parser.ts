import { AGL } from "../assets/font-data.ts";
import type { FontVerticals } from "../text/line-metrics.ts";

export class AFMParser {
  private advanceWidths: Record<string, number> = {};
  private kerningPairs: Record<string, Record<string, number>> = {};
  private glyphMap: Record<string, string> = {};

  // The font's bounding box in glyph space (1000 units / em), from the AFM header. This - not the
  // `Ascender` line - is what a line box is built from; see `verticals()`.
  private bbox: [number, number, number, number] = [0, 0, 0, 0];
  private cachedVerticals?: FontVerticals; // never changes for a face; asked once per line

  constructor(afmData: string) {
    this.parseAFMData(afmData);
    this.loadGlyphList();
  }

  private loadGlyphList(): void {
    const lines = AGL.split("\n");

    for (const line of lines) {
      const parts = line.trim().split(";");
      if (parts.length >= 2) {
        const unicodeHex = parts[0];
        const glyphName = parts[1];

        // Converts the Unicode hex code into the corresponding character
        const unicodeChar = String.fromCharCode(parseInt(unicodeHex, 16));

        // Adds the character as the key and the glyph name as the value in the list
        this.glyphMap[unicodeChar] = glyphName;
      }
    }
  }

  private getGlyphName(char: string): string {
    return this.glyphMap[char] || char;
  }

  private parseAFMData(afmData: string): void {
    const lines = afmData.split("\n");
    let inCharMetrics = false;

    for (let line of lines) {
      line = line.trim();

      if (line.startsWith("StartCharMetrics")) {
        inCharMetrics = true;
        continue;
      }

      if (line.startsWith("EndCharMetrics")) {
        inCharMetrics = false;
        continue;
      }

      if (inCharMetrics) {
        const charData = this.parseCharMetrics(line);
        if (charData) {
          const { charName, wx } = charData;
          this.advanceWidths[charName] = wx;
        }
      }

      if (line.startsWith("FontBBox ")) {
        const [x0, y0, x1, y1] = line.slice(9).trim().split(/\s+/).map(parseFloat);
        this.bbox = [x0, y0, x1, y1];
      }

      if (line.startsWith("KPX")) {
        const parts = line.split(/\s+/);
        const firstChar = parts[1];
        const secondChar = parts[2];
        const kerning = parseFloat(parts[3]);
        // Nested by first glyph, then second. A flat `${a}-${b}` key would have to be BUILT on every
        // lookup, and getKerning runs once per adjacent character pair - that string allocation was a
        // quarter of a standard-font render.
        (this.kerningPairs[firstChar] ??= {})[secondChar] = kerning;
      }
    }
  }

  private parseCharMetrics(line: string): { charName: string; wx: number } | null {
    const parts = line.split(";").map((part) => part.trim());

    let charName = "";
    let wx = 0;

    for (const part of parts) {
      if (part.startsWith("N ")) {
        charName = part.split(" ")[1];
      }

      if (part.startsWith("WX ")) {
        wx = parseFloat(part.split(" ")[1]);
      }
    }

    if (charName && wx) {
      return { charName, wx };
    }

    return null;
  }

  /**
   * The font's LINE metrics, as fractions of the em: how far a line box must reach above and below
   * the baseline. Taken from the `FontBBox`.
   *
   * Not from the AFM's `Ascender` / `Descender` lines, and that distinction is the whole point.
   * `Ascender 718` is a GLYPH metric - the height of `b`, `d`, `h` - and for Helvetica it happens to
   * equal the cap height. The line-metric equivalent is TrueType's `hhea.ascent`, which is much
   * taller because it has to clear the accented capitals: Arial declares 0.905 where its caps reach
   * 0.716. That surplus above the caps (0.189) is about as large as the descent below the baseline
   * (0.212), which is exactly why capitals look vertically centred in a browser.
   *
   * Helvetica's `FontBBox` is `-166 -225 1000 931`: 0.931 up, 0.225 down - within a hair of Arial's
   * hhea numbers. So the bbox IS the standard-14 line metric, and there is no leftover slack to
   * call a lineGap. (Seating the baseline at `Ascender` instead put every capital too high; see
   * ISSUE-5.)
   */
  verticals(): FontVerticals {
    if (this.cachedVerticals) return this.cachedVerticals;
    const [, yMin, , yMax] = this.bbox;
    this.cachedVerticals = { ascent: yMax / 1000, descent: -yMin / 1000, lineGap: 0 };
    return this.cachedVerticals;
  }

  getAdvanceWidth(charName: string): number {
    return this.advanceWidths[this.getGlyphName(charName)] || 0;
  }

  getKerning(firstChar: string, secondChar: string): number {
    return this.kerningPairs[firstChar]?.[secondChar] ?? 0;
  }
}

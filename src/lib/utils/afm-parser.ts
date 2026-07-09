import { AGL } from "../assets/font-data.ts";

export class AFMParser {
  private advanceWidths: Record<string, number> = {};
  private kerningPairs: Record<string, Record<string, number>> = {};
  private glyphMap: Record<string, string> = {};

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

  getAdvanceWidth(charName: string): number {
    return this.advanceWidths[this.getGlyphName(charName)] || 0;
  }

  getKerning(firstChar: string, secondChar: string): number {
    return this.kerningPairs[firstChar]?.[secondChar] ?? 0;
  }
}

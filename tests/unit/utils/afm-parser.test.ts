import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { STANDARD_FONT_NAMES, standardParser } from "../../../src/lib/utils/afm-parser.ts";

// The metrics ship pre-parsed (scripts/gen-font-data.mjs). This holds them to the AFM files, read
// the way the engine read them before: every character, every pair, every header value.
const ASSETS = new URL("../../../src/lib/assets/", import.meta.url);

const glyphOf: Record<string, string> = {};
for (const line of readFileSync(new URL("agl.txt", ASSETS), "utf-8").split("\n")) {
  const parts = line.trim().split(";");
  if (parts.length >= 2) glyphOf[String.fromCharCode(parseInt(parts[0]!, 16))] = parts[1]!;
}
Object.assign(glyphOf, {
  " ": "space",
  "­": "hyphen",
  "²": "twosuperior",
  "³": "threesuperior",
  "¹": "onesuperior",
});
const nameOf = (char: string) => glyphOf[char] || char;

function readAfm(text: string) {
  const widths: Record<string, number> = {};
  const kerning: Record<string, Record<string, number>> = {};
  const header: Record<string, number[]> = {};
  let inCharMetrics = false;
  for (let line of text.split("\n")) {
    line = line.trim();
    if (line.startsWith("StartCharMetrics")) inCharMetrics = true;
    else if (line.startsWith("EndCharMetrics")) inCharMetrics = false;
    else if (inCharMetrics) {
      const name = /N (\S+)/.exec(line)?.[1];
      const wx = parseFloat(/WX (\S+)/.exec(line)?.[1] ?? "0");
      if (name && wx) widths[name] = wx;
    }
    const [key, ...values] = line.split(/\s+/);
    if (
      ["FontBBox", "UnderlinePosition", "UnderlineThickness", "CapHeight", "XHeight"].includes(key!)
    ) {
      header[key!] = values.map(parseFloat);
    }
    if (key === "KPX") (kerning[values[0]!] ??= {})[values[1]!] = parseFloat(values[2]!);
  }
  return { widths, kerning, header };
}

const FILES = readdirSync(ASSETS).filter((f) => f.endsWith(".afm"));
const ALL_BMP = Array.from({ length: 0x10000 }, (_, i) => String.fromCharCode(i));

describe("the standard font metrics", () => {
  it("cover exactly the 14 AFM files", () => {
    expect(FILES.map((f) => f.replace(/\.afm$/, "")).sort()).toEqual(
      [...STANDARD_FONT_NAMES].sort(),
    );
  });

  describe.each(FILES)("%s", (file) => {
    const afm = readAfm(readFileSync(new URL(file, ASSETS), "utf-8"));
    const parser = standardParser(file.replace(/\.afm$/, ""));

    it("measures every character as the AFM does", () => {
      for (const char of ALL_BMP) {
        expect([char, parser.getAdvanceWidth(char)]).toEqual([char, afm.widths[nameOf(char)] || 0]);
      }
    });

    it("kerns every pair as the AFM does", () => {
      // Every character that maps to a glyph in a pair, on either side, against every other one.
      const names = new Set(
        Object.entries(afm.kerning).flatMap(([a, bs]) => [a, ...Object.keys(bs)]),
      );
      const chars = ALL_BMP.filter((c) => names.has(nameOf(c)));
      let pairs = 0;
      for (const a of chars) {
        for (const b of chars) {
          const expected = afm.kerning[nameOf(a)]?.[nameOf(b)] ?? 0;
          if (expected) pairs++;
          if (parser.getKerning(a, b) !== expected) {
            expect([a, b, parser.getKerning(a, b)]).toEqual([a, b, expected]);
          }
        }
      }
      // Not vacuous: the Courier faces carry no pairs, every other text face hundreds.
      if (!/Courier|Symbol|ZapfDingbats/.test(file)) expect(pairs).toBeGreaterThan(100);
    });

    it("reads its line and decoration metrics from the header", () => {
      const [, yMin, , yMax] = afm.header["FontBBox"]!;
      expect(parser.verticals()).toEqual({
        ascent: yMax! / 1000,
        descent: -yMin! / 1000,
        lineGap: 0,
      });
      const cap = afm.header["CapHeight"]?.[0] || yMax!;
      expect(parser.decoration()).toEqual({
        underlinePosition: -afm.header["UnderlinePosition"]![0]! / 1000,
        underlineThickness: afm.header["UnderlineThickness"]![0]! / 1000,
        capHeight: cap / 1000,
        xHeight: (afm.header["XHeight"]?.[0] || cap / 2) / 1000,
      });
    });
  });
});

describe("loading the metrics", () => {
  it("refuses to measure before they are loaded, instead of measuring 0", async () => {
    vi.resetModules(); // a fresh module: nothing loaded yet
    const fresh = await import("../../../src/lib/utils/afm-parser.ts");
    expect(() => fresh.standardParser("Helvetica").getAdvanceWidth("A")).toThrow(
      "await preloadStandardFonts() first",
    );
    await fresh.preloadStandardFonts();
    expect(fresh.standardParser("Helvetica").getAdvanceWidth("A")).toBe(667);
  });

  it("are loaded before PDFDocument.build(), which may measure", async () => {
    vi.resetModules(); // a fresh engine: nothing loaded, as in an app's first render
    const { PDFDocument } = await import("../../../src/lib/renderer/pdf-document-class.ts");
    const { FontStyle } = await import("../../../src/lib/utils/pdf-object-manager.ts");
    const { Document, Page, Text } = await import("../../../src/lib/api/index.ts");
    let measured = 0;
    class Sized extends PDFDocument {
      build() {
        measured = this.objectManager.getStringWidth("Hello", "Helvetica", 12, FontStyle.Normal);
        return Document([Page([Text("Hello")])]);
      }
    }
    await Sized.render();
    expect(measured).toBeCloseTo(27.336, 3);
  });
});

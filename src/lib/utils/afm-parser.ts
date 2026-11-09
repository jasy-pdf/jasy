import type { FontVerticals } from "../text/line-metrics.ts";
import type { FontDecoration } from "../text/text-decoration.ts";

/** One standard font's metrics, pre-parsed from its AFM file by scripts/gen-font-data.mjs. */
export interface StandardFontData {
  /** FontBBox, in glyph units (1000 / em). */
  bbox: number[];
  /** UnderlinePosition (negative: below the baseline), UnderlineThickness. */
  underline: number[];
  capHeight: number;
  xHeight: number;
  /** The advance of every glyph by index; 0 where the font has none. */
  widths: number[];
  /** [first, count, second - previous second, value, ...] */
  kerning: number[];
}

/** The 14 names, known without their data: registering a font must not wait for it. */
export const STANDARD_FONT_NAMES: ReadonlySet<string> = new Set([
  "Courier",
  "Courier-Bold",
  "Courier-BoldOblique",
  "Courier-Oblique",
  "Helvetica",
  "Helvetica-Bold",
  "Helvetica-BoldOblique",
  "Helvetica-Oblique",
  "Symbol",
  "Times-Bold",
  "Times-BoldItalic",
  "Times-Italic",
  "Times-Roman",
  "ZapfDingbats",
]);

// The metrics are 155 KB of numbers that only a render needs, so they are loaded then, and an app
// that ships jasy does not carry them in its start bundle. Layout is synchronous: everything that
// measures awaits this first (PDFRenderer.render, fillForm, flattenForm).
let metrics: typeof import("../assets/standard-fonts.ts") | undefined;
let loading: Promise<void> | undefined;
let glyphOf: Map<string, number> | undefined;

/**
 * Loads the metrics of the 14 standard fonts. Every render does this itself; call it ahead of time to
 * have the first PDF without the wait, or to measure outside a render. Once per process.
 */
export function preloadStandardFonts(): Promise<void> {
  // ".js", not ".ts": tsc rewrites the extension of a static import, not of a dynamic one.
  return (loading ??= import("../assets/standard-fonts.js").then(
    (m) => {
      metrics = m;
      glyphOf = new Map();
      for (let i = 0; i < m.CHARS.length; i += 2) {
        glyphOf.set(String.fromCharCode(m.CHARS[i]!), m.CHARS[i + 1]!);
      }
    },
    (e) => {
      loading = undefined; // a chunk lost to a deploy: the next render tries again
      throw e;
    },
  ));
}

/** One parser per standard-14 face for the whole process: the metrics are constants and a parsed
 *  face is read-only, so every document can share one. */
const STANDARD_PARSERS = new Map<string, AFMParser>();
export function standardParser(fullName: string): AFMParser {
  let parser = STANDARD_PARSERS.get(fullName);
  if (!parser) STANDARD_PARSERS.set(fullName, (parser = new AFMParser(fullName)));
  return parser;
}

/** A standard font's metrics, read on first use - by then a render has loaded them. */
export class AFMParser {
  private font?: {
    widths: number[];
    kerning: Map<number, Map<number, number>>;
    bbox: number[];
    underline: number[];
    capHeight: number;
    xHeight: number;
  };
  private cachedVerticals?: FontVerticals; // never changes for a face; asked once per line
  private cachedDecoration?: FontDecoration;

  constructor(private readonly fullName: string) {}

  private get data() {
    if (this.font) return this.font;
    const raw = metrics?.FONTS[this.fullName];
    if (!raw) {
      throw new Error(
        metrics
          ? `@jasy/pdf: "${this.fullName}" is not one of the 14 standard fonts.`
          : "@jasy/pdf: the standard font metrics are not loaded. A render loads them itself; to " +
              "measure text outside one, await preloadStandardFonts() first.",
      );
    }
    const kerning = new Map<number, Map<number, number>>();
    for (let i = 0; i < raw.kerning.length; ) {
      const first = raw.kerning[i++]!;
      const pairs = new Map<number, number>();
      let second = 0;
      for (let n = raw.kerning[i++]!; n > 0; n--) {
        second += raw.kerning[i++]!;
        pairs.set(second, raw.kerning[i++]!);
      }
      kerning.set(first, pairs);
    }
    return (this.font = { ...raw, kerning });
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
    const [, yMin, , yMax] = this.data.bbox;
    this.cachedVerticals = { ascent: yMax / 1000, descent: -yMin / 1000, lineGap: 0 };
    return this.cachedVerticals;
  }

  /**
   * The font's decoration metrics (underline / strikethrough), as fractions of the em.
   *
   * Symbol and ZapfDingbats declare no `CapHeight`/`XHeight` - they have no lowercase letters. For
   * those the bbox top is the only height the font gives us, so the capitals reach it and a
   * strikethrough crosses at half of that. Still read from the font, not guessed.
   */
  decoration(): FontDecoration {
    if (this.cachedDecoration) return this.cachedDecoration;
    const { bbox, underline, xHeight } = this.data;
    const capHeight = this.data.capHeight || bbox[3]!;
    this.cachedDecoration = {
      underlinePosition: -underline[0]! / 1000, // AFM writes it negative (below the baseline)
      underlineThickness: underline[1]! / 1000,
      capHeight: capHeight / 1000,
      xHeight: (xHeight || capHeight / 2) / 1000,
    };
    return this.cachedDecoration;
  }

  /** One character's advance. A string of several characters is not a glyph name here: it measures 0. */
  getAdvanceWidth(char: string): number {
    const { widths } = this.data; // first: it throws when the metrics are not loaded
    const glyph = glyphOf!.get(char);
    return glyph === undefined ? 0 : widths[glyph]!;
  }

  /** The pair's kerning. The AFM keys its pairs by GLYPH, like its widths - so the characters are
   *  mapped to glyphs first, or only letter-letter pairs (where the two coincide) would ever hit. */
  getKerning(firstChar: string, secondChar: string): number {
    const { kerning } = this.data;
    const first = glyphOf!.get(firstChar);
    const second = glyphOf!.get(secondChar);
    if (first === undefined || second === undefined) return 0;
    return kerning.get(first)?.get(second) ?? 0;
  }
}

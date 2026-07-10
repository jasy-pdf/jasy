// Parses the metric tables of a TrueType (.ttf) font - the binary counterpart to AFMParser.
// Slice 1: glyph advance widths (hmtx) + the Unicode→glyph map (cmap), enough to compute
// text width the same way AFMParser does for the standard-14. Embedding/subsetting come later.

import { i16, latin1FromBytes, u8, u16, u32 } from "./bytes.ts";
import type { FontDecoration } from "../text/text-decoration.ts";

interface TableRecord {
  offset: number;
  length: number;
}

// A glyph outline as drawing commands, in font units (em = unitsPerEm). TrueType curves are
// quadratic (one control point), so "Q" is enough - no cubic. Consumers scale by fontSize / em.
export type GlyphPathCommand =
  | { type: "M"; x: number; y: number }
  | { type: "L"; x: number; y: number }
  | { type: "Q"; cx: number; cy: number; x: number; y: number }
  | { type: "Z" };

// One contour point during glyf parsing: on-curve points are anchors, off-curve are quadratic
// control points (with implied on-curve midpoints between two consecutive off-curve points).
interface GlyphPoint {
  x: number;
  y: number;
  on: boolean;
}

// One contiguous codepoint→glyph range from a format-12 cmap (kept un-expanded; CJK ranges
// are huge, so we search them on lookup instead of filling a Map with millions of entries).
interface CmapGroup {
  start: number;
  end: number;
  startGlyph: number;
}

// An sRGB color from the CPAL palette (0..255 per channel).
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

// A color-line stop for a gradient: a position 0..1 and its color (null = the text foreground).
export interface ColorStop {
  offset: number;
  color: RGBA | null;
}

// How the fill of one color layer is painted. `solid` is COLR v0 and the common v1 leaf; the
// gradients are v1. All coordinates are in font units (the renderer scales + positions them).
export type Paint =
  | { type: "solid"; color: RGBA | null }
  | {
      type: "linearGradient";
      p0: [number, number];
      p1: [number, number];
      stops: ColorStop[];
      extend: "pad" | "repeat" | "reflect";
    }
  | {
      type: "radialGradient";
      c0: [number, number, number]; // x, y, radius
      c1: [number, number, number];
      stops: ColorStop[];
      extend: "pad" | "repeat" | "reflect";
    };

// A 2x3 affine transform [a, b, c, d, e, f] in font units: (x, y) -> (a*x + c*y + e, b*x + d*y + f).
// Matches the PDF/SVG matrix convention.
export type Affine = [number, number, number, number, number, number];

// One layer of a color glyph: an outline glyph filled with a `Paint`, optionally under an affine
// `transform` (COLR v1 PaintTransform & co.; absent = identity). Back-to-front order (first drawn
// underneath). Unifies COLR v0 (all solid) and v1 (a paint graph), so the renderer has one shape to
// draw whichever version the font uses.
export interface ColorGlyphLayer {
  glyphId: number;
  paint: Paint;
  transform?: Affine;
}

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** Sorts x-intervals and unions the overlapping ones. */
export function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  if (spans.length === 0) return spans;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [sorted[0]];
  for (const [start, end] of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

function isIdentity(m: Affine): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

// compose(m, n): the transform that applies n first, then m (the matrix product m . n).
function compose(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// A transform applied about a center point: translate(c) . t . translate(-c).
function aroundCenter(t: Affine, cx: number, cy: number): Affine {
  return compose([1, 0, 0, 1, cx, cy], compose(t, [1, 0, 0, 1, -cx, -cy]));
}

// Applies an affine to a point (font units).
function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// The affine's mean scale factor sqrt(|det|), used to scale a gradient radius (a circle can only
// stay a circle under uniform scaling; this is the best single-radius approximation otherwise).
function detScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export class TTFParser {
  unitsPerEm = 1000;
  // FontDescriptor metrics, in PDF glyph space (1000 units / em).
  ascent = 0;
  descent = 0;
  // Extra leading the font asks for between two lines (hhea), same glyph space. Often 0.
  lineGap = 0;
  // Decoration metrics in RAW font units (divide by unitsPerEm). `post` always carries the underline
  // pair; `OS/2` only carries sxHeight/sCapHeight from version 2 on, so those may stay 0 and are
  // then measured off the glyph outlines instead (see `decoration()`).
  private underlinePositionRaw = 0; // negative = below the baseline
  private underlineThicknessRaw = 0;
  private xHeightRaw = 0;
  private capHeightRaw = 0;
  private cachedDecoration?: FontDecoration;
  bbox: [number, number, number, number] = [0, 0, 0, 0];
  private numGlyphs = 0;
  private numHMetrics = 0;
  private indexToLocFormat = 0; // head[50]: 0 = short loca (offsets/2), 1 = long loca
  private advanceWidths: number[] = []; // per glyph id, in font units
  private cmap = new Map<number, number>(); // codepoint → glyph id (format 4)
  private cmapGroups: CmapGroup[] = []; // format 12, searched on lookup
  private tables: Record<string, TableRecord> = {};
  // COLR v0: base glyph id → its slice of the layer-record array. Empty when the font has no
  // v0 color layers, so getColorGlyph falls back to v1 or to normal (monochrome) drawing.
  private colrBase = new Map<number, { first: number; count: number }>();
  private colrLayersOffset = 0; // byte offset of the v0 layer-record array in the COLR table
  private palette: RGBA[] = []; // CPAL palette 0, indexed by palette entry
  // COLR v1: base glyph id → the absolute offset of its Paint table (a recursive paint graph).
  private colrBaseV1 = new Map<number, number>();
  private colrLayerListOffset = 0; // absolute offset of the v1 LayerList (paint-offset array)
  // Kerning: (leftGid << 16 | rightGid) -> value in FONT UNITS (from the `kern` table and/or GPOS).
  private kernPairs = new Map<number, number>();
  private hasKerning = false;
  // GPOS Type 2 (pair positioning) subtables, in absolute byte offsets. Queried per pair (format 2
  // is class-based, so it cannot be enumerated into `kernPairs` up front). Preferred over `kern`.
  private gposPairPos: number[] = [];

  constructor(private data: Uint8Array) {
    this.readTableDirectory();
    const head = this.table("head").offset;
    this.unitsPerEm = u16(this.data, head + 18);
    this.numGlyphs = u16(this.data, this.table("maxp").offset + 4);
    this.numHMetrics = u16(this.data, this.table("hhea").offset + 34);
    this.bbox = [
      this.toGlyphSpace(i16(this.data, head + 36)), // xMin
      this.toGlyphSpace(i16(this.data, head + 38)), // yMin
      this.toGlyphSpace(i16(this.data, head + 40)), // xMax
      this.toGlyphSpace(i16(this.data, head + 42)), // yMax
    ];
    const hhea = this.table("hhea").offset;
    this.ascent = this.toGlyphSpace(i16(this.data, hhea + 4));
    this.descent = this.toGlyphSpace(i16(this.data, hhea + 6));
    this.lineGap = this.toGlyphSpace(i16(this.data, hhea + 8));
    this.readDecorationMetrics();
    this.indexToLocFormat = i16(this.data, head + 50);
    this.readHmtx();
    this.readCmap();
    if (this.tables["COLR"] && this.tables["CPAL"]) {
      this.readColr();
      this.readCpal();
    }
    // Kerning tables are optional and only ever make text prettier; a malformed one must degrade to
    // "no kerning", never break font loading. Guard both.
    try {
      if (this.tables["kern"]) this.readKern();
      if (this.tables["GPOS"]) this.readGpos();
    } catch {
      this.kernPairs.clear();
      this.gposPairPos = [];
      this.hasKerning = false;
    }
  }

  // The raw font bytes, for the /FontFile2 stream.
  getData(): Uint8Array {
    return this.data;
  }

  glyphCount(): number {
    return this.numGlyphs;
  }

  // Advance width of every glyph in PDF glyph space (the /W array of the CIDFont).
  glyphWidths(): number[] {
    const out: number[] = [];
    for (let g = 0; g < this.numGlyphs; g++) {
      out.push(this.toGlyphSpace(this.getAdvanceWidth(g)));
    }
    return out;
  }

  // glyph id → Unicode codepoint, for the /ToUnicode CMap (BMP / format-4 coverage).
  reverseCmap(): Map<number, number> {
    const out = new Map<number, number>();
    this.cmap.forEach((gid, code) => {
      if (!out.has(gid)) out.set(gid, code);
    });
    return out;
  }

  private toGlyphSpace(v: number): number {
    return Math.round((v * 1000) / this.unitsPerEm);
  }

  // Codepoint → glyph id (0 = .notdef when the font has no glyph for it).
  getGlyphIndex(codePoint: number): number {
    const g = this.cmap.get(codePoint);
    if (g !== undefined) return g;
    for (const r of this.cmapGroups) {
      if (codePoint >= r.start && codePoint <= r.end) {
        return r.startGlyph + (codePoint - r.start);
      }
    }
    return 0;
  }

  // Advance width of a glyph in font units. Glyphs past numHMetrics reuse the last advance.
  getAdvanceWidth(glyphIndex: number): number {
    const i = Math.min(glyphIndex, this.numHMetrics - 1);
    return this.advanceWidths[i] ?? 0;
  }

  // Char width at fontSize, scaled from font units (em = unitsPerEm) to points.
  getCharWidth(char: string, fontSize: number): number {
    const units = this.getAdvanceWidth(this.getGlyphIndex(char.codePointAt(0)!));
    return (units / this.unitsPerEm) * fontSize;
  }

  // String width at fontSize.
  getStringWidth(text: string, fontSize: number): number {
    let width = 0;
    for (const ch of text) width += this.getCharWidth(ch, fontSize);
    return width;
  }

  // `post` carries the underline pair (always, from its header); `OS/2` carries the x- and cap-height
  // but only from version 2 on. Both tables are optional in principle, so nothing here may throw.
  private readDecorationMetrics(): void {
    const post = this.tables["post"];
    if (post) {
      this.underlinePositionRaw = i16(this.data, post.offset + 8);
      this.underlineThicknessRaw = i16(this.data, post.offset + 10);
    }
    const os2 = this.tables["OS/2"];
    if (os2 && u16(this.data, os2.offset) >= 2) {
      this.xHeightRaw = i16(this.data, os2.offset + 86);
      this.capHeightRaw = i16(this.data, os2.offset + 88);
    }
  }

  /**
   * Underline / strikethrough geometry, as fractions of the em.
   *
   * A font without `post` (rare) gets the classic 10% below the baseline at 5% thickness - the same
   * numbers all 14 standard AFMs happen to declare, so it is a measured convention rather than an
   * invention. A font whose `OS/2` predates version 2 has no x- or cap-height, so we MEASURE them off
   * the outlines of `x` and `H` instead of guessing.
   */
  decoration(): FontDecoration {
    if (this.cachedDecoration) return this.cachedDecoration;
    const em = this.unitsPerEm;
    const xHeight = this.xHeightRaw || this.outlineTop(0x78); // "x"
    const capHeight = this.capHeightRaw || this.outlineTop(0x48); // "H"
    this.cachedDecoration = {
      underlinePosition: this.underlinePositionRaw ? -this.underlinePositionRaw / em : 0.1,
      underlineThickness: this.underlineThicknessRaw ? this.underlineThicknessRaw / em : 0.05,
      xHeight: xHeight / em,
      capHeight: capHeight / em,
    };
    return this.cachedDecoration;
  }

  /** The highest ON-CURVE point of a code point's outline, in font units; 0 for a missing glyph.
   *  A quadratic's control point may sit above the curve, so it is not a bound - and `x`/`H` have
   *  flat tops in any face where this fallback matters. */
  private outlineTop(codePoint: number): number {
    let top = 0;
    for (const cmd of this.getGlyphPath(this.getGlyphIndex(codePoint))) {
      if (cmd.type !== "Z" && cmd.y > top) top = cmd.y;
    }
    return top;
  }

  /**
   * Where a glyph's INK crosses a horizontal band, as x-intervals in font units (pen origin at 0).
   * This is what lets an underline step around a descender ("skip-ink"), the way a browser does.
   *
   * Scanline fill: sample a few horizontal lines across the band, find every place the outline
   * crosses them, and pair the crossings up into filled spans. A handful of scanlines is plenty -
   * the band is a few percent of the em tall, and a descender stem does not wander inside it.
   *
   * `yTop` / `yBottom` are in font units, y UP from the baseline (so both are negative under it).
   * Returns [] for a glyph with no outline (a space, an unmapped code point, a composite we cannot
   * decompose) - the caller then leaves the line unbroken there, which is the safe direction.
   */
  inkSpansInBand(codePoint: number, yTop: number, yBottom: number): Array<[number, number]> {
    const path = this.getGlyphPath(this.getGlyphIndex(codePoint));
    if (path.length === 0) return [];

    // Flatten to straight edges; a quadratic becomes a short polyline (the band is thin, so a
    // coarse subdivision is already below the printing resolution).
    const edges: Array<[number, number, number, number]> = [];
    let startX = 0;
    let startY = 0;
    let curX = 0;
    let curY = 0;
    const edge = (x: number, y: number): void => {
      edges.push([curX, curY, x, y]);
      curX = x;
      curY = y;
    };
    for (const cmd of path) {
      if (cmd.type === "M") {
        [curX, curY] = [cmd.x, cmd.y];
        [startX, startY] = [cmd.x, cmd.y];
      } else if (cmd.type === "L") {
        edge(cmd.x, cmd.y);
      } else if (cmd.type === "Q") {
        const [x0, y0] = [curX, curY];
        const STEPS = 8;
        for (let i = 1; i <= STEPS; i++) {
          const t = i / STEPS;
          const u = 1 - t;
          edge(
            u * u * x0 + 2 * u * t * cmd.cx + t * t * cmd.x,
            u * u * y0 + 2 * u * t * cmd.cy + t * t * cmd.y,
          );
        }
      } else {
        edge(startX, startY); // Z: close the contour
      }
    }

    const SCANLINES = 5;
    const spans: Array<[number, number]> = [];
    for (let i = 0; i < SCANLINES; i++) {
      const y = yTop + ((yBottom - yTop) * i) / (SCANLINES - 1);
      const xs: number[] = [];
      for (const [x0, y0, x1, y1] of edges) {
        if (y0 === y1) continue;
        // Half-open test so a vertex on the scanline is counted exactly once.
        if (y >= Math.min(y0, y1) && y < Math.max(y0, y1)) {
          xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) spans.push([xs[k], xs[k + 1]]);
    }
    return mergeSpans(spans);
  }

  /** True if the font declares any horizontal kerning (kern table or GPOS). */
  kerns(): boolean {
    return this.hasKerning;
  }

  /** Kerning between two glyphs, in em/1000 (the standard-14 unit); 0 if the pair is not kerned.
   *  Negative tightens, matching the AFM sign. GPOS wins over the legacy `kern` table when both
   *  exist (it is what a modern shaper uses, and can carry more pairs). */
  getKerning(leftGid: number, rightGid: number): number {
    let units: number | undefined;
    if (this.gposPairPos.length > 0) units = this.gposKern(leftGid, rightGid);
    if (units === undefined) units = this.kernPairs.get((leftGid << 16) | rightGid);
    return units === undefined ? 0 : Math.round((units * 1000) / this.unitsPerEm);
  }

  // The legacy `kern` table, format 0 (an explicit list of glyph-pair adjustments). Only horizontal
  // format-0 subtables are read; GPOS (parsed separately) supersedes this in modern fonts, but old
  // TrueType (DejaVu, FreeSans) carries its kerning here.
  private readKern(): void {
    const base = this.tables["kern"].offset;
    // The OpenType (Microsoft) header is version:u16 = 0, nTables:u16. (Apple's is a u32 version; the
    // fonts we target use the OpenType form.)
    if (u16(this.data, base) !== 0) return;
    const nTables = u16(this.data, base + 2);
    let p = base + 4;
    for (let t = 0; t < nTables; t++) {
      const length = u16(this.data, p + 2);
      const coverage = u16(this.data, p + 4);
      const format = coverage >> 8;
      const horizontal = (coverage & 0x1) === 1;
      if (format === 0 && horizontal) {
        const nPairs = u16(this.data, p + 6);
        let q = p + 14; // past nPairs, searchRange, entrySelector, rangeShift
        for (let i = 0; i < nPairs; i++) {
          const left = u16(this.data, q);
          const right = u16(this.data, q + 2);
          const value = i16(this.data, q + 4);
          this.kernPairs.set((left << 16) | right, value);
          q += 6;
        }
      }
      p += length;
    }
    if (this.kernPairs.size > 0) this.hasKerning = true;
  }

  // GPOS pair-adjustment kerning. We collect the PairPos (lookup type 2) subtables of the `kern`
  // FEATURE only - not every pair-positioning lookup - so this is kerning, not arbitrary shaping.
  // Script/language selection is skipped: the `kern` feature is the same across the Latin scripts we
  // target, so a flat scan of the feature list for tag "kern" is correct here. Only pair positioning
  // (type 2) is read; the rest of GPOS (mark attachment, cursive, contextual) is not kerning.
  private readGpos(): void {
    const base = this.tables["GPOS"].offset;
    const featureListOffset = base + u16(this.data, base + 6);
    const lookupListOffset = base + u16(this.data, base + 8);

    // Every lookup index referenced by a "kern" feature.
    const kernLookups = new Set<number>();
    const featureCount = u16(this.data, featureListOffset);
    for (let i = 0; i < featureCount; i++) {
      const rec = featureListOffset + 2 + i * 6;
      const tag = String.fromCharCode(
        this.data[rec],
        this.data[rec + 1],
        this.data[rec + 2],
        this.data[rec + 3],
      );
      if (tag !== "kern") continue;
      const feature = featureListOffset + u16(this.data, rec + 4);
      const lookupIndexCount = u16(this.data, feature + 2);
      for (let j = 0; j < lookupIndexCount; j++) {
        kernLookups.add(u16(this.data, feature + 4 + j * 2));
      }
    }
    if (kernLookups.size === 0) return;

    // The PairPos subtables of those lookups (a lookup of another type in the set is ignored).
    const lookupCount = u16(this.data, lookupListOffset);
    for (const idx of kernLookups) {
      if (idx >= lookupCount) continue;
      const lookup = lookupListOffset + u16(this.data, lookupListOffset + 2 + idx * 2);
      if (u16(this.data, lookup) !== 2) continue; // lookupType 2 = pair adjustment
      const subTableCount = u16(this.data, lookup + 4);
      for (let s = 0; s < subTableCount; s++) {
        this.gposPairPos.push(lookup + u16(this.data, lookup + 6 + s * 2));
      }
    }
    if (this.gposPairPos.length > 0) this.hasKerning = true;
  }

  // The XAdvance adjustment on the LEFT glyph for a pair, in font units, from the first PairPos
  // subtable that covers it; undefined if none does. (Kerning only ever uses value1's XAdvance.)
  private gposKern(leftGid: number, rightGid: number): number | undefined {
    for (const sub of this.gposPairPos) {
      const posFormat = u16(this.data, sub);
      const coverage = sub + u16(this.data, sub + 2);
      const covIndex = this.coverageIndex(coverage, leftGid);
      if (covIndex < 0) continue;
      const valueFormat1 = u16(this.data, sub + 4);
      const valueFormat2 = u16(this.data, sub + 6);
      const v1size = TTFParser.valueRecordSize(valueFormat1);
      const v2size = TTFParser.valueRecordSize(valueFormat2);

      if (posFormat === 1) {
        const pairSet = sub + u16(this.data, sub + 10 + covIndex * 2);
        const pairValueCount = u16(this.data, pairSet);
        const recSize = 2 + v1size + v2size;
        for (let i = 0; i < pairValueCount; i++) {
          const rec = pairSet + 2 + i * recSize;
          if (u16(this.data, rec) === rightGid) {
            return this.xAdvance(rec + 2, valueFormat1);
          }
        }
      } else if (posFormat === 2) {
        const classDef1 = sub + u16(this.data, sub + 8);
        const classDef2 = sub + u16(this.data, sub + 10);
        const class2Count = u16(this.data, sub + 14);
        const c1 = this.classOf(classDef1, leftGid);
        const c2 = this.classOf(classDef2, rightGid);
        const recSize = v1size + v2size;
        const record = sub + 16 + (c1 * class2Count + c2) * recSize;
        return this.xAdvance(record, valueFormat1);
      }
    }
    return undefined;
  }

  private static valueRecordSize(valueFormat: number): number {
    let bits = 0;
    for (let m = valueFormat; m; m >>= 1) bits += m & 1;
    return bits * 2;
  }

  // The XAdvance field of a GPOS value record, or 0 if the format has none. XAdvance (bit 0x0004) is
  // preceded by XPlacement (0x0001) and YPlacement (0x0002), each an i16 when present.
  private xAdvance(recordOffset: number, valueFormat: number): number {
    if ((valueFormat & 0x0004) === 0) return 0;
    let off = recordOffset;
    if (valueFormat & 0x0001) off += 2;
    if (valueFormat & 0x0002) off += 2;
    return i16(this.data, off);
  }

  // Coverage index of a glyph, or -1. Format 1: sorted glyph list. Format 2: sorted ranges.
  private coverageIndex(offset: number, gid: number): number {
    const format = u16(this.data, offset);
    if (format === 1) {
      const count = u16(this.data, offset + 2);
      let lo = 0;
      let hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = u16(this.data, offset + 4 + mid * 2);
        if (gid < g) hi = mid - 1;
        else if (gid > g) lo = mid + 1;
        else return mid;
      }
      return -1;
    }
    if (format === 2) {
      const rangeCount = u16(this.data, offset + 2);
      for (let i = 0; i < rangeCount; i++) {
        const rec = offset + 4 + i * 6;
        const start = u16(this.data, rec);
        const end = u16(this.data, rec + 2);
        if (gid >= start && gid <= end) return u16(this.data, rec + 4) + (gid - start);
      }
    }
    return -1;
  }

  // Class of a glyph in a ClassDef, or 0 (the default class). Format 1: run from a start glyph.
  // Format 2: ranges. Glyphs not listed are class 0.
  private classOf(offset: number, gid: number): number {
    const format = u16(this.data, offset);
    if (format === 1) {
      const startGlyph = u16(this.data, offset + 2);
      const glyphCount = u16(this.data, offset + 4);
      if (gid >= startGlyph && gid < startGlyph + glyphCount) {
        return u16(this.data, offset + 6 + (gid - startGlyph) * 2);
      }
      return 0;
    }
    if (format === 2) {
      const rangeCount = u16(this.data, offset + 2);
      for (let i = 0; i < rangeCount; i++) {
        const rec = offset + 4 + i * 6;
        const start = u16(this.data, rec);
        const end = u16(this.data, rec + 2);
        if (gid >= start && gid <= end) return u16(this.data, rec + 4);
      }
    }
    return 0;
  }

  private table(tag: string): TableRecord {
    const t = this.tables[tag];
    if (!t) throw new Error(`TTF: missing required table "${tag}"`);
    return t;
  }

  private readTableDirectory(): void {
    const numTables = u16(this.data, 4);
    let p = 12; // after the offset table (sfntVersion + numTables + 3 fields)
    for (let i = 0; i < numTables; i++) {
      const tag = latin1FromBytes(this.data.subarray(p, p + 4));
      this.tables[tag] = {
        offset: u32(this.data, p + 8),
        length: u32(this.data, p + 12),
      };
      p += 16;
    }
  }

  // hmtx is numHMetrics {advanceWidth, lsb} pairs, then lsb-only entries that reuse the last advance.
  private readHmtx(): void {
    const o = this.table("hmtx").offset;
    let last = 0;
    for (let i = 0; i < this.numGlyphs; i++) {
      if (i < this.numHMetrics) last = u16(this.data, o + i * 4);
      this.advanceWidths.push(last);
    }
  }

  private readCmap(): void {
    const base = this.table("cmap").offset;
    const numTables = u16(this.data, base + 2);

    // Read EVERY Unicode subtable, not just one: fonts commonly ship a (3,1) format-4 for the BMP
    // AND a (3,10) format-12 for astral code points (emoji, CJK-ext). Reading only the first would
    // drop astral coverage. Format-4 fills the direct map; format-12 groups are searched on lookup,
    // and getGlyphIndex checks the map first, so an overlapping BMP entry stays correct.
    let p = base + 4;
    for (let i = 0; i < numTables; i++) {
      const platform = u16(this.data, p);
      const encoding = u16(this.data, p + 2);
      const offset = u32(this.data, p + 4);
      p += 8;
      const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
      if (!unicode) continue;
      const subtable = base + offset;
      const format = u16(this.data, subtable);
      if (format === 4) this.readCmapFormat4(subtable);
      else if (format === 12) this.readCmapFormat12(subtable);
    }
  }

  // Format 4: segment mapping. Four parallel arrays keyed by segment; the glyph comes either
  // from idDelta or, when idRangeOffset != 0, from the glyphIdArray it points into.
  private readCmapFormat4(o: number): void {
    const segCountX2 = u16(this.data, o + 6);
    const endCodes = o + 14;
    const startCodes = endCodes + segCountX2 + 2; // +2 reservedPad
    const idDeltas = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;

    for (let i = 0; i < segCountX2 / 2; i++) {
      const end = u16(this.data, endCodes + i * 2);
      const start = u16(this.data, startCodes + i * 2);
      const delta = u16(this.data, idDeltas + i * 2);
      const rangeOffset = u16(this.data, idRangeOffsets + i * 2);

      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (c + delta) & 0xffff;
        } else {
          glyph = u16(this.data, idRangeOffsets + i * 2 + rangeOffset + (c - start) * 2);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) this.cmap.set(c, glyph);
      }
    }
  }

  // Format 12: sequential groups for full Unicode (incl. astral). Kept un-expanded.
  private readCmapFormat12(o: number): void {
    const nGroups = u32(this.data, o + 12);
    let p = o + 16;
    for (let i = 0; i < nGroups; i++) {
      this.cmapGroups.push({
        start: u32(this.data, p),
        end: u32(this.data, p + 4),
        startGlyph: u32(this.data, p + 8),
      });
      p += 12;
    }
  }

  // True when the font carries glyph outlines we can draw (a `glyf`+`loca` pair). CFF/OTF fonts
  // and bitmap-only fonts return false - color layers need vector outlines.
  hasGlyfOutlines(): boolean {
    return this.tables["glyf"] !== undefined && this.tables["loca"] !== undefined;
  }

  // Byte range of glyph `glyphId` inside the glyf table, via the loca offset array. An empty range
  // (start === end) means the glyph has no outline (e.g. the space) - returns null.
  private glyfRange(glyphId: number): { start: number; end: number } | null {
    const loca = this.table("loca").offset;
    let start: number;
    let end: number;
    if (this.indexToLocFormat === 0) {
      // short loca stores offsets divided by two
      start = u16(this.data, loca + glyphId * 2) * 2;
      end = u16(this.data, loca + (glyphId + 1) * 2) * 2;
    } else {
      start = u32(this.data, loca + glyphId * 4);
      end = u32(this.data, loca + (glyphId + 1) * 4);
    }
    return end > start ? { start, end } : null;
  }

  // Glyph outline as drawing commands in font units. Empty for glyphs without an outline. Composite
  // glyphs (numberOfContours < 0) are not assembled yet - they return empty (a follow-up sub-step).
  getGlyphPath(glyphId: number): GlyphPathCommand[] {
    if (!this.hasGlyfOutlines()) return [];
    const range = this.glyfRange(glyphId);
    if (!range) return [];

    const g = this.table("glyf").offset + range.start;
    const numberOfContours = i16(this.data, g);
    if (numberOfContours < 0) return []; // composite: deferred

    return this.parseSimpleGlyph(g, numberOfContours);
  }

  // Simple-glyph body: end-point indices per contour, then flags, then delta-encoded x/y runs.
  private parseSimpleGlyph(g: number, numberOfContours: number): GlyphPathCommand[] {
    let p = g + 10; // past numberOfContours + the four bbox int16s

    const endPts: number[] = [];
    for (let i = 0; i < numberOfContours; i++) {
      endPts.push(u16(this.data, p));
      p += 2;
    }
    const numPoints = numberOfContours === 0 ? 0 : endPts[endPts.length - 1] + 1;

    const instructionLength = u16(this.data, p);
    p += 2 + instructionLength; // skip hinting instructions

    // Flags, with the REPEAT bit (0x08) run-length-encoding a flag byte.
    const flags: number[] = [];
    while (flags.length < numPoints) {
      const flag = u8(this.data, p++);
      flags.push(flag);
      if (flag & 0x08) {
        let repeat = u8(this.data, p++);
        while (repeat-- > 0) flags.push(flag);
      }
    }

    // X then Y coordinates, each a delta from the previous. Short (1 byte, sign in a flag bit) or
    // long (int16), or "same as previous" (delta 0) when the short bit is clear but the same bit set.
    const xs = this.readCoordinates(flags, p, 0x02, 0x10);
    p = xs.next;
    const ys = this.readCoordinates(flags, p, 0x04, 0x20);

    const points: GlyphPoint[] = flags.map((flag, i) => ({
      x: xs.values[i],
      y: ys.values[i],
      on: (flag & 0x01) !== 0,
    }));

    const commands: GlyphPathCommand[] = [];
    let contourStart = 0;
    for (const endPt of endPts) {
      this.contourToCommands(points.slice(contourStart, endPt + 1), commands);
      contourStart = endPt + 1;
    }
    return commands;
  }

  // Decodes one delta-encoded coordinate axis. `shortBit` = value is a single unsigned byte;
  // `sameBit` = (short) its sign, or (long) repeat the previous value (delta 0).
  private readCoordinates(
    flags: number[],
    start: number,
    shortBit: number,
    sameBit: number,
  ): { values: number[]; next: number } {
    let p = start;
    let value = 0;
    const values: number[] = [];
    for (const flag of flags) {
      if (flag & shortBit) {
        const delta = u8(this.data, p++);
        value += flag & sameBit ? delta : -delta;
      } else if (!(flag & sameBit)) {
        value += i16(this.data, p);
        p += 2;
      }
      // else: sameBit set without shortBit => delta 0, value unchanged
      values.push(value);
    }
    return { values, next: p };
  }

  // Converts one TrueType contour (mixed on/off-curve points) into path commands. Between two
  // consecutive off-curve control points TrueType implies an on-curve midpoint; we insert those,
  // rotate the contour to begin on an on-curve anchor, then emit quads (off->on) and lines (on->on).
  private contourToCommands(raw: GlyphPoint[], out: GlyphPathCommand[]): void {
    const n = raw.length;
    if (n === 0) return;

    const pts: GlyphPoint[] = [];
    for (let i = 0; i < n; i++) {
      const cur = raw[i];
      pts.push(cur);
      const next = raw[(i + 1) % n];
      if (!cur.on && !next.on) {
        pts.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, on: true });
      }
    }

    const firstOn = pts.findIndex((pt) => pt.on);
    if (firstOn < 0) return; // degenerate: no anchor even after inserting midpoints

    const loop = [...pts.slice(firstOn), ...pts.slice(0, firstOn)]; // starts on an on-curve anchor
    const start = loop[0];

    out.push({ type: "M", x: start.x, y: start.y });
    let i = 1;
    while (i < loop.length) {
      const cur = loop[i];
      if (cur.on) {
        out.push({ type: "L", x: cur.x, y: cur.y });
        i += 1;
      } else {
        // An off-curve control is always followed by an on-curve point (real or implied); at the
        // end of the loop that closing anchor is the start point itself.
        const end = i + 1 < loop.length ? loop[i + 1] : start;
        out.push({ type: "Q", cx: cur.x, cy: cur.y, x: end.x, y: end.y });
        i += 2;
      }
    }
    out.push({ type: "Z" });
  }

  // True when the font has color glyphs we can render: COLR base glyphs (v0 or v1) plus a CPAL
  // palette to color them.
  hasColorGlyphs(): boolean {
    return (this.colrBase.size > 0 || this.colrBaseV1.size > 0) && this.palette.length > 0;
  }

  // The color layers of a base glyph, back-to-front (first drawn underneath), or null when the glyph
  // has no COLR entry (draw it as a normal monochrome glyph then). Prefers the richer v1 paint graph
  // when present, else reads the v0 records; both resolve to the same `ColorGlyphLayer` shape.
  getColorGlyph(glyphId: number): ColorGlyphLayer[] | null {
    const v1 = this.colrBaseV1.get(glyphId);
    if (v1 !== undefined) return this.walkColrLayers(v1, IDENTITY, new Set());

    const rec = this.colrBase.get(glyphId);
    if (!rec) return null;
    const layers: ColorGlyphLayer[] = [];
    for (let i = 0; i < rec.count; i++) {
      const o = this.colrLayersOffset + (rec.first + i) * 4;
      const paletteIndex = u16(this.data, o + 2);
      layers.push({
        glyphId: u16(this.data, o),
        paint: { type: "solid", color: this.paletteColor(paletteIndex, 1) },
      });
    }
    return layers;
  }

  // Walks a v1 paint (sub)tree into the flat list of glyph-clipped layers it draws, carrying the
  // accumulated affine `m` down the graph. Handles the structural paints: PaintColrLayers (a list),
  // PaintGlyph (a glyph + its fill), PaintColrGlyph (a reference), the transform paints (compose
  // into `m`), and PaintComposite (backdrop under source). Unhandled paints (rotate/skew, the
  // variable variants) are skipped. `seen` guards against cyclic references.
  private walkColrLayers(paintOffset: number, m: Affine, seen: Set<number>): ColorGlyphLayer[] {
    const key = paintOffset;
    if (seen.has(key)) return [];
    seen.add(key);

    const format = u8(this.data, paintOffset);
    const child = (): number => paintOffset + this.u24(paintOffset + 1);
    const descend = (t: Affine): ColorGlyphLayer[] =>
      this.walkColrLayers(child(), compose(m, t), seen);

    switch (format) {
      case 1: {
        // PaintColrLayers: numLayers (u8) starting at firstLayerIndex (u32) into the LayerList.
        const numLayers = u8(this.data, paintOffset + 1);
        const first = u32(this.data, paintOffset + 2);
        const out: ColorGlyphLayer[] = [];
        for (let i = 0; i < numLayers; i++) {
          const layerPaint =
            this.colrLayerListOffset +
            u32(this.data, this.colrLayerListOffset + 4 + (first + i) * 4);
          out.push(...this.walkColrLayers(layerPaint, m, new Set(seen)));
        }
        return out;
      }
      case 10: {
        // PaintGlyph: paint (Offset24 to the fill) + glyphID (u16). The fill paints inside the glyph.
        const fill = this.resolveFill(paintOffset + this.u24(paintOffset + 1), IDENTITY);
        if (!fill) return [];
        const layer: ColorGlyphLayer = { glyphId: u16(this.data, paintOffset + 4), paint: fill };
        if (!isIdentity(m)) layer.transform = m;
        return [layer];
      }
      case 11: {
        // PaintColrGlyph: draw another base glyph's paint graph under the current transform.
        const ref = this.colrBaseV1.get(u16(this.data, paintOffset + 1));
        return ref !== undefined ? this.walkColrLayers(ref, m, new Set(seen)) : [];
      }
      case 12: // PaintTransform: child + an Affine2x3 (six Fixed 16.16 values).
        return descend(this.readAffine(paintOffset + this.u24(paintOffset + 4)));
      case 14: // PaintTranslate: dx, dy (FWORD).
        return descend([
          1,
          0,
          0,
          1,
          i16(this.data, paintOffset + 4),
          i16(this.data, paintOffset + 6),
        ]);
      case 16: // PaintScale: scaleX, scaleY (F2Dot14).
        return descend([this.f2dot14(paintOffset + 4), 0, 0, this.f2dot14(paintOffset + 6), 0, 0]);
      case 18: // PaintScaleAroundCenter: scaleX, scaleY, centerX, centerY.
        return descend(
          aroundCenter(
            [this.f2dot14(paintOffset + 4), 0, 0, this.f2dot14(paintOffset + 6), 0, 0],
            i16(this.data, paintOffset + 8),
            i16(this.data, paintOffset + 10),
          ),
        );
      case 20: {
        // PaintScaleUniform: a single scale for both axes.
        const s = this.f2dot14(paintOffset + 4);
        return descend([s, 0, 0, s, 0, 0]);
      }
      case 22: {
        // PaintScaleUniformAroundCenter: uniform scale about a center.
        const s = this.f2dot14(paintOffset + 4);
        return descend(
          aroundCenter(
            [s, 0, 0, s, 0, 0],
            i16(this.data, paintOffset + 6),
            i16(this.data, paintOffset + 8),
          ),
        );
      }
      case 32: {
        // PaintComposite: sourcePaint, mode (u8), backdropPaint. We treat every mode as source-over:
        // draw the backdrop underneath, then the source on top (correct for the common case).
        const source = paintOffset + this.u24(paintOffset + 1);
        const backdrop = paintOffset + this.u24(paintOffset + 5);
        return [
          ...this.walkColrLayers(backdrop, m, new Set(seen)),
          ...this.walkColrLayers(source, m, new Set(seen)),
        ];
      }
      default:
        return []; // a bare fill with no glyph, or a paint format not supported yet
    }
  }

  // Resolves the fill under a PaintGlyph to a solid or gradient `Paint`, descending through any
  // transform paints and baking the accumulated affine `t` into the gradient's coordinates (so the
  // renderer only has to apply the OUTER glyph transform). Returns null for a still-unsupported fill.
  private resolveFill(paintOffset: number, t: Affine): Paint | null {
    const format = u8(this.data, paintOffset);
    const child = (): number => paintOffset + this.u24(paintOffset + 1);
    const p = (x: number, y: number): [number, number] => applyAffine(t, x, y);
    switch (format) {
      case 2: {
        // PaintSolid: paletteIndex (u16) + alpha (F2Dot14). A solid fill ignores the transform.
        const paletteIndex = u16(this.data, paintOffset + 1);
        return {
          type: "solid",
          color: this.paletteColor(paletteIndex, this.f2dot14(paintOffset + 3)),
        };
      }
      case 4: {
        // PaintLinearGradient: a color line + p0/p1 (a rotation point p2 we treat axially).
        const line = this.readColorLine(paintOffset + this.u24(paintOffset + 1));
        return {
          type: "linearGradient",
          p0: p(i16(this.data, paintOffset + 4), i16(this.data, paintOffset + 6)),
          p1: p(i16(this.data, paintOffset + 8), i16(this.data, paintOffset + 10)),
          stops: line.stops,
          extend: line.extend,
        };
      }
      case 6: {
        // PaintRadialGradient: a color line + two circles. Radii scale by the affine's mean scale.
        const line = this.readColorLine(paintOffset + this.u24(paintOffset + 1));
        const rScale = detScale(t);
        const [c0x, c0y] = p(i16(this.data, paintOffset + 4), i16(this.data, paintOffset + 6));
        const [c1x, c1y] = p(i16(this.data, paintOffset + 10), i16(this.data, paintOffset + 12));
        return {
          type: "radialGradient",
          c0: [c0x, c0y, u16(this.data, paintOffset + 8) * rScale],
          c1: [c1x, c1y, u16(this.data, paintOffset + 14) * rScale],
          stops: line.stops,
          extend: line.extend,
        };
      }
      // Transform paints wrapping the fill: compose into `t` and descend to the actual gradient.
      case 12:
        return this.resolveFill(
          child(),
          compose(t, this.readAffine(paintOffset + this.u24(paintOffset + 4))),
        );
      case 14:
        return this.resolveFill(
          child(),
          compose(t, [
            1,
            0,
            0,
            1,
            i16(this.data, paintOffset + 4),
            i16(this.data, paintOffset + 6),
          ]),
        );
      case 16:
        return this.resolveFill(
          child(),
          compose(t, [this.f2dot14(paintOffset + 4), 0, 0, this.f2dot14(paintOffset + 6), 0, 0]),
        );
      case 18:
        return this.resolveFill(
          child(),
          compose(
            t,
            aroundCenter(
              [this.f2dot14(paintOffset + 4), 0, 0, this.f2dot14(paintOffset + 6), 0, 0],
              i16(this.data, paintOffset + 8),
              i16(this.data, paintOffset + 10),
            ),
          ),
        );
      case 20: {
        const s = this.f2dot14(paintOffset + 4);
        return this.resolveFill(child(), compose(t, [s, 0, 0, s, 0, 0]));
      }
      case 22: {
        const s = this.f2dot14(paintOffset + 4);
        return this.resolveFill(
          child(),
          compose(
            t,
            aroundCenter(
              [s, 0, 0, s, 0, 0],
              i16(this.data, paintOffset + 6),
              i16(this.data, paintOffset + 8),
            ),
          ),
        );
      }
      default:
        return null;
    }
  }

  // A ColorLine: an extend mode then color stops (position + palette color).
  private readColorLine(o: number): { stops: ColorStop[]; extend: "pad" | "repeat" | "reflect" } {
    const extend = (["pad", "repeat", "reflect"] as const)[u8(this.data, o)] ?? "pad";
    const numStops = u16(this.data, o + 1);
    const stops: ColorStop[] = [];
    for (let i = 0; i < numStops; i++) {
      const p = o + 3 + i * 6;
      stops.push({
        offset: this.f2dot14(p),
        color: this.paletteColor(u16(this.data, p + 2), this.f2dot14(p + 4)),
      });
    }
    return { stops, extend };
  }

  // A CPAL palette color scaled by a gradient/solid alpha (0..1). paletteIndex 0xFFFF is the spec's
  // "use the text foreground color" sentinel -> null.
  private paletteColor(paletteIndex: number, alpha: number): RGBA | null {
    if (paletteIndex === 0xffff) return null;
    const c = this.palette[paletteIndex];
    if (!c) return null;
    return { r: c.r, g: c.g, b: c.b, a: Math.round(c.a * alpha) };
  }

  // A big-endian 24-bit offset (used for a paint's sub-offsets).
  private u24(o: number): number {
    return (u8(this.data, o) << 16) | (u8(this.data, o + 1) << 8) | u8(this.data, o + 2);
  }

  // An F2Dot14 fixed-point number (signed, 2 integer + 14 fraction bits) as a float.
  private f2dot14(o: number): number {
    return i16(this.data, o) / 16384;
  }

  // A signed 32-bit big-endian integer.
  private i32(o: number): number {
    const v = u32(this.data, o);
    return v >= 0x80000000 ? v - 0x100000000 : v;
  }

  // An Affine2x3 struct: six Fixed (16.16) values xx, yx, xy, yy, dx, dy -> [a, b, c, d, e, f].
  private readAffine(o: number): Affine {
    const fixed = (p: number): number => this.i32(p) / 65536;
    return [fixed(o), fixed(o + 4), fixed(o + 8), fixed(o + 12), fixed(o + 16), fixed(o + 20)];
  }

  // COLR header (v0 and v1). v0: base-glyph + layer records (solid). v1 (version >= 1): additionally
  // a BaseGlyphList of paint graphs + a LayerList they index into.
  private readColr(): void {
    const o = this.table("COLR").offset;
    const version = u16(this.data, o);

    const numBaseGlyphs = u16(this.data, o + 2);
    const baseOffset = o + u32(this.data, o + 4);
    this.colrLayersOffset = o + u32(this.data, o + 8);
    for (let i = 0; i < numBaseGlyphs; i++) {
      const p = baseOffset + i * 6;
      this.colrBase.set(u16(this.data, p), {
        first: u16(this.data, p + 2),
        count: u16(this.data, p + 4),
      });
    }

    if (version < 1) return;
    // v1 fields follow the v0 ones: BaseGlyphList (glyphID -> paint offset) + LayerList.
    const baseGlyphListOffset = u32(this.data, o + 14);
    const layerListOffset = u32(this.data, o + 18);
    if (layerListOffset) this.colrLayerListOffset = o + layerListOffset;
    if (baseGlyphListOffset) {
      const listStart = o + baseGlyphListOffset;
      const numRecords = u32(this.data, listStart);
      for (let i = 0; i < numRecords; i++) {
        const p = listStart + 4 + i * 6;
        this.colrBaseV1.set(u16(this.data, p), listStart + u32(this.data, p + 2));
      }
    }
  }

  // CPAL: reads palette 0 into `palette`. Color records are BGRA bytes; colorRecordIndices[0] is
  // where palette 0 starts in the shared record array.
  private readCpal(): void {
    const o = this.table("CPAL").offset;
    const numPaletteEntries = u16(this.data, o + 2);
    const recordsOffset = o + u32(this.data, o + 8);
    const firstRecord = u16(this.data, o + 12); // colorRecordIndices[0], the start of palette 0
    for (let i = 0; i < numPaletteEntries; i++) {
      const p = recordsOffset + (firstRecord + i) * 4;
      this.palette.push({
        b: u8(this.data, p),
        g: u8(this.data, p + 1),
        r: u8(this.data, p + 2),
        a: u8(this.data, p + 3),
      });
    }
  }
}

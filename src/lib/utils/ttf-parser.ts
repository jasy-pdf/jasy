// Parses the metric tables of a TrueType (.ttf) font - the binary counterpart to AFMParser.
// Slice 1: glyph advance widths (hmtx) + the Unicode→glyph map (cmap), enough to compute
// text width the same way AFMParser does for the standard-14. Embedding/subsetting come later.

import { i16, latin1FromBytes, u16, u32 } from "./bytes.ts";

interface TableRecord {
  offset: number;
  length: number;
}

// One contiguous codepoint→glyph range from a format-12 cmap (kept un-expanded; CJK ranges
// are huge, so we search them on lookup instead of filling a Map with millions of entries).
interface CmapGroup {
  start: number;
  end: number;
  startGlyph: number;
}

export class TTFParser {
  unitsPerEm = 1000;
  // FontDescriptor metrics, in PDF glyph space (1000 units / em).
  ascent = 0;
  descent = 0;
  bbox: [number, number, number, number] = [0, 0, 0, 0];
  private numGlyphs = 0;
  private numHMetrics = 0;
  private advanceWidths: number[] = []; // per glyph id, in font units
  private cmap = new Map<number, number>(); // codepoint → glyph id (format 4)
  private cmapGroups: CmapGroup[] = []; // format 12, searched on lookup
  private tables: Record<string, TableRecord> = {};

  constructor(private data: Uint8Array) {
    this.readTableDirectory();
    const head = this.table("head").offset;
    this.unitsPerEm = u16(this.data,head + 18);
    this.numGlyphs = u16(this.data,this.table("maxp").offset + 4);
    this.numHMetrics = u16(this.data,this.table("hhea").offset + 34);
    this.bbox = [
      this.toGlyphSpace(i16(this.data,head + 36)), // xMin
      this.toGlyphSpace(i16(this.data,head + 38)), // yMin
      this.toGlyphSpace(i16(this.data,head + 40)), // xMax
      this.toGlyphSpace(i16(this.data,head + 42)), // yMax
    ];
    const hhea = this.table("hhea").offset;
    this.ascent = this.toGlyphSpace(i16(this.data,hhea + 4));
    this.descent = this.toGlyphSpace(i16(this.data,hhea + 6));
    this.readHmtx();
    this.readCmap();
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

  private table(tag: string): TableRecord {
    const t = this.tables[tag];
    if (!t) throw new Error(`TTF: missing required table "${tag}"`);
    return t;
  }

  private readTableDirectory(): void {
    const numTables = u16(this.data,4);
    let p = 12; // after the offset table (sfntVersion + numTables + 3 fields)
    for (let i = 0; i < numTables; i++) {
      const tag = latin1FromBytes(this.data.subarray(p, p + 4));
      this.tables[tag] = {
        offset: u32(this.data,p + 8),
        length: u32(this.data,p + 12),
      };
      p += 16;
    }
  }

  // hmtx is numHMetrics {advanceWidth, lsb} pairs, then lsb-only entries that reuse the last advance.
  private readHmtx(): void {
    const o = this.table("hmtx").offset;
    let last = 0;
    for (let i = 0; i < this.numGlyphs; i++) {
      if (i < this.numHMetrics) last = u16(this.data,o + i * 4);
      this.advanceWidths.push(last);
    }
  }

  private readCmap(): void {
    const base = this.table("cmap").offset;
    const numTables = u16(this.data,base + 2);

    // Prefer the Windows Unicode BMP subtable (3,1); accept full-Unicode (3,10) or any (0,x).
    let subtable = -1;
    let p = base + 4;
    for (let i = 0; i < numTables; i++) {
      const platform = u16(this.data,p);
      const encoding = u16(this.data,p + 2);
      const offset = u32(this.data,p + 4);
      const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
      if (unicode) {
        subtable = base + offset;
        if (platform === 3 && encoding === 1) break; // best fit, stop looking
      }
      p += 8;
    }
    if (subtable < 0) return;

    const format = u16(this.data,subtable);
    if (format === 4) this.readCmapFormat4(subtable);
    else if (format === 12) this.readCmapFormat12(subtable);
  }

  // Format 4: segment mapping. Four parallel arrays keyed by segment; the glyph comes either
  // from idDelta or, when idRangeOffset != 0, from the glyphIdArray it points into.
  private readCmapFormat4(o: number): void {
    const segCountX2 = u16(this.data,o + 6);
    const endCodes = o + 14;
    const startCodes = endCodes + segCountX2 + 2; // +2 reservedPad
    const idDeltas = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;

    for (let i = 0; i < segCountX2 / 2; i++) {
      const end = u16(this.data,endCodes + i * 2);
      const start = u16(this.data,startCodes + i * 2);
      const delta = u16(this.data,idDeltas + i * 2);
      const rangeOffset = u16(this.data,idRangeOffsets + i * 2);

      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (c + delta) & 0xffff;
        } else {
          glyph = u16(this.data,idRangeOffsets + i * 2 + rangeOffset + (c - start) * 2);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) this.cmap.set(c, glyph);
      }
    }
  }

  // Format 12: sequential groups for full Unicode (incl. astral). Kept un-expanded.
  private readCmapFormat12(o: number): void {
    const nGroups = u32(this.data,o + 12);
    let p = o + 16;
    for (let i = 0; i < nGroups; i++) {
      this.cmapGroups.push({
        start: u32(this.data,p),
        end: u32(this.data,p + 4),
        startGlyph: u32(this.data,p + 8),
      });
      p += 12;
    }
  }
}

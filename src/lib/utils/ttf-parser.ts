// Parses the metric tables of a TrueType (.ttf) font - the binary counterpart to AFMParser.
// Slice 1: glyph advance widths (hmtx) + the Unicode→glyph map (cmap), enough to compute
// text width the same way AFMParser does for the standard-14. Embedding/subsetting come later.

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
  private numGlyphs = 0;
  private numHMetrics = 0;
  private advanceWidths: number[] = []; // per glyph id, in font units
  private cmap = new Map<number, number>(); // codepoint → glyph id (format 4)
  private cmapGroups: CmapGroup[] = []; // format 12, searched on lookup
  private tables: Record<string, TableRecord> = {};

  constructor(private data: Buffer) {
    this.readTableDirectory();
    this.unitsPerEm = this.data.readUInt16BE(this.table("head").offset + 18);
    this.numGlyphs = this.data.readUInt16BE(this.table("maxp").offset + 4);
    this.numHMetrics = this.data.readUInt16BE(this.table("hhea").offset + 34);
    this.readHmtx();
    this.readCmap();
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

  // String width at fontSize, scaled from font units (em = unitsPerEm) to points.
  getStringWidth(text: string, fontSize: number): number {
    let units = 0;
    for (const ch of text) {
      units += this.getAdvanceWidth(this.getGlyphIndex(ch.codePointAt(0)!));
    }
    return (units / this.unitsPerEm) * fontSize;
  }

  private table(tag: string): TableRecord {
    const t = this.tables[tag];
    if (!t) throw new Error(`TTF: missing required table "${tag}"`);
    return t;
  }

  private readTableDirectory(): void {
    const numTables = this.data.readUInt16BE(4);
    let p = 12; // after the offset table (sfntVersion + numTables + 3 fields)
    for (let i = 0; i < numTables; i++) {
      const tag = this.data.toString("latin1", p, p + 4);
      this.tables[tag] = {
        offset: this.data.readUInt32BE(p + 8),
        length: this.data.readUInt32BE(p + 12),
      };
      p += 16;
    }
  }

  // hmtx is numHMetrics {advanceWidth, lsb} pairs, then lsb-only entries that reuse the last advance.
  private readHmtx(): void {
    const o = this.table("hmtx").offset;
    let last = 0;
    for (let i = 0; i < this.numGlyphs; i++) {
      if (i < this.numHMetrics) last = this.data.readUInt16BE(o + i * 4);
      this.advanceWidths.push(last);
    }
  }

  private readCmap(): void {
    const base = this.table("cmap").offset;
    const numTables = this.data.readUInt16BE(base + 2);

    // Prefer the Windows Unicode BMP subtable (3,1); accept full-Unicode (3,10) or any (0,x).
    let subtable = -1;
    let p = base + 4;
    for (let i = 0; i < numTables; i++) {
      const platform = this.data.readUInt16BE(p);
      const encoding = this.data.readUInt16BE(p + 2);
      const offset = this.data.readUInt32BE(p + 4);
      const unicode = (platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0;
      if (unicode) {
        subtable = base + offset;
        if (platform === 3 && encoding === 1) break; // best fit, stop looking
      }
      p += 8;
    }
    if (subtable < 0) return;

    const format = this.data.readUInt16BE(subtable);
    if (format === 4) this.readCmapFormat4(subtable);
    else if (format === 12) this.readCmapFormat12(subtable);
  }

  // Format 4: segment mapping. Four parallel arrays keyed by segment; the glyph comes either
  // from idDelta or, when idRangeOffset != 0, from the glyphIdArray it points into.
  private readCmapFormat4(o: number): void {
    const segCountX2 = this.data.readUInt16BE(o + 6);
    const endCodes = o + 14;
    const startCodes = endCodes + segCountX2 + 2; // +2 reservedPad
    const idDeltas = startCodes + segCountX2;
    const idRangeOffsets = idDeltas + segCountX2;

    for (let i = 0; i < segCountX2 / 2; i++) {
      const end = this.data.readUInt16BE(endCodes + i * 2);
      const start = this.data.readUInt16BE(startCodes + i * 2);
      const delta = this.data.readUInt16BE(idDeltas + i * 2);
      const rangeOffset = this.data.readUInt16BE(idRangeOffsets + i * 2);

      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph: number;
        if (rangeOffset === 0) {
          glyph = (c + delta) & 0xffff;
        } else {
          glyph = this.data.readUInt16BE(idRangeOffsets + i * 2 + rangeOffset + (c - start) * 2);
          if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph !== 0) this.cmap.set(c, glyph);
      }
    }
  }

  // Format 12: sequential groups for full Unicode (incl. astral). Kept un-expanded.
  private readCmapFormat12(o: number): void {
    const nGroups = this.data.readUInt32BE(o + 12);
    let p = o + 16;
    for (let i = 0; i < nGroups; i++) {
      this.cmapGroups.push({
        start: this.data.readUInt32BE(p),
        end: this.data.readUInt32BE(p + 4),
        startGlyph: this.data.readUInt32BE(p + 8),
      });
      p += 12;
    }
  }
}

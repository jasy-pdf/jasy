// Parses the metric tables of a TrueType (.ttf) font - the binary counterpart to AFMParser.
// Slice 1: glyph advance widths (hmtx) + the Unicode→glyph map (cmap), enough to compute
// text width the same way AFMParser does for the standard-14. Embedding/subsetting come later.

import { i16, latin1FromBytes, u8, u16, u32 } from "./bytes.ts";

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

// One layer of a color glyph: an outline glyph filled with a `Paint`. Back-to-front order (first
// drawn underneath). Unifies COLR v0 (all solid) and v1 (a paint graph), so the renderer has one
// shape to draw whichever version the font uses.
export interface ColorGlyphLayer {
  glyphId: number;
  paint: Paint;
}

export class TTFParser {
  unitsPerEm = 1000;
  // FontDescriptor metrics, in PDF glyph space (1000 units / em).
  ascent = 0;
  descent = 0;
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
    this.indexToLocFormat = i16(this.data, head + 50);
    this.readHmtx();
    this.readCmap();
    if (this.tables["COLR"] && this.tables["CPAL"]) {
      this.readColr();
      this.readCpal();
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
    if (v1 !== undefined) return this.walkColrLayers(v1, new Set());

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

  // Walks a v1 paint (sub)tree into the flat list of glyph-clipped layers it draws. Handles the
  // structural paints - PaintColrLayers (a list), PaintGlyph (a glyph + its fill) and PaintColrGlyph
  // (a reference to another base glyph). Unsupported structural paints (transforms, composites) are
  // skipped for now. `seen` guards against cyclic PaintColrGlyph references.
  private walkColrLayers(paintOffset: number, seen: Set<number>): ColorGlyphLayer[] {
    if (seen.has(paintOffset)) return [];
    seen.add(paintOffset);

    const format = u8(this.data, paintOffset);
    if (format === 1) {
      // PaintColrLayers: numLayers (u8) starting at firstLayerIndex (u32) into the LayerList.
      const numLayers = u8(this.data, paintOffset + 1);
      const first = u32(this.data, paintOffset + 2);
      const out: ColorGlyphLayer[] = [];
      for (let i = 0; i < numLayers; i++) {
        const layerPaint =
          this.colrLayerListOffset + u32(this.data, this.colrLayerListOffset + 4 + (first + i) * 4);
        out.push(...this.walkColrLayers(layerPaint, seen));
      }
      return out;
    }
    if (format === 10) {
      // PaintGlyph: paint (Offset24 to the fill) + glyphID (u16). The fill paints inside the glyph.
      const fill = this.resolveFill(paintOffset + this.u24(paintOffset + 1));
      return fill ? [{ glyphId: u16(this.data, paintOffset + 4), paint: fill }] : [];
    }
    if (format === 11) {
      // PaintColrGlyph: draw another base glyph's paint graph.
      const ref = this.colrBaseV1.get(u16(this.data, paintOffset + 1));
      return ref !== undefined ? this.walkColrLayers(ref, seen) : [];
    }
    return []; // a bare fill with no glyph, or a paint format not supported yet
  }

  // Resolves the fill of a PaintGlyph to a solid or gradient `Paint`, or null when it is a paint
  // format not handled yet (a nested layer list, a transform, a composite - added later).
  private resolveFill(paintOffset: number): Paint | null {
    const format = u8(this.data, paintOffset);
    if (format === 2) {
      // PaintSolid: paletteIndex (u16) + alpha (F2Dot14).
      const paletteIndex = u16(this.data, paintOffset + 1);
      return {
        type: "solid",
        color: this.paletteColor(paletteIndex, this.f2dot14(paintOffset + 3)),
      };
    }
    if (format === 4) {
      // PaintLinearGradient: a color line + p0/p1 (and a rotation point p2 we treat axially).
      const stops = this.readColorLine(paintOffset + this.u24(paintOffset + 1));
      return {
        type: "linearGradient",
        p0: [i16(this.data, paintOffset + 4), i16(this.data, paintOffset + 6)],
        p1: [i16(this.data, paintOffset + 8), i16(this.data, paintOffset + 10)],
        stops: stops.stops,
        extend: stops.extend,
      };
    }
    if (format === 6) {
      // PaintRadialGradient: a color line + two circles (center + radius).
      const stops = this.readColorLine(paintOffset + this.u24(paintOffset + 1));
      return {
        type: "radialGradient",
        c0: [
          i16(this.data, paintOffset + 4),
          i16(this.data, paintOffset + 6),
          u16(this.data, paintOffset + 8),
        ],
        c1: [
          i16(this.data, paintOffset + 10),
          i16(this.data, paintOffset + 12),
          u16(this.data, paintOffset + 14),
        ],
        stops: stops.stops,
        extend: stops.extend,
      };
    }
    return null;
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

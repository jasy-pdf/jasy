// A minimal but valid TTF with the 5 metric tables and 4 glyphs (.notdef, 'A', 'B', ' ')
// and known advance widths, so tests can assert exact metrics without an MB-sized font.
// Pass `advances` to mint a distinct variant (e.g. a wider "bold") - default is A=500, B=700.
export function buildTestTtf(advances: number[] = [0, 500, 700, 250]): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1000, 18); // unitsPerEm

  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(advances.length, 4); // numGlyphs

  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(advances.length, 34); // numberOfHMetrics

  const hmtx = Buffer.alloc(advances.length * 4);
  advances.forEach((a, i) => hmtx.writeUInt16BE(a, i * 4)); // {advanceWidth, lsb=0}

  // cmap format 4: segments {space}, {A..B}, {0xFFFF terminator}; idDelta maps each char.
  const sub = Buffer.alloc(40);
  sub.writeUInt16BE(4, 0); // format
  sub.writeUInt16BE(40, 2); // length
  sub.writeUInt16BE(6, 6); // segCountX2 (3 segments)
  const endCodes = 14;
  const startCodes = endCodes + 6 + 2; // +2 reservedPad
  const idDeltas = startCodes + 6;
  [0x20, 0x42, 0xffff].forEach((v, i) => sub.writeUInt16BE(v, endCodes + i * 2));
  [0x20, 0x41, 0xffff].forEach((v, i) => sub.writeUInt16BE(v, startCodes + i * 2));
  [65507, 65472, 1].forEach((v, i) => sub.writeUInt16BE(v, idDeltas + i * 2));

  const cmapHeader = Buffer.alloc(12);
  cmapHeader.writeUInt16BE(1, 2); // numTables
  cmapHeader.writeUInt16BE(3, 4); // platformID
  cmapHeader.writeUInt16BE(1, 6); // encodingID
  cmapHeader.writeUInt32BE(12, 8); // subtable offset
  const cmap = Buffer.concat([cmapHeader, sub]);

  return assembleTtf([
    ["head", head],
    ["maxp", maxp],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["cmap", cmap],
  ]);
}

// A minimal TTF whose cmap is FORMAT 12, mapping a single astral code point (default U+1F600 😀)
// to a glyph with a known advance (default 900 units @ em 1000). Lets tests assert that astral
// text is measured by code point, not by UTF-16 unit (an emoji is one glyph, not two half-widths).
export function buildAstralTtf(codePoint = 0x1f600, advance = 900): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1000, 18); // unitsPerEm

  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(2, 4); // numGlyphs: .notdef + the emoji

  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(2, 34); // numberOfHMetrics

  const hmtx = Buffer.alloc(8);
  hmtx.writeUInt16BE(0, 0); // .notdef advance
  hmtx.writeUInt16BE(advance, 4); // emoji glyph advance

  // cmap format 12: one sequential group {codePoint -> glyph 1}.
  const sub = Buffer.alloc(28);
  sub.writeUInt16BE(12, 0); // format
  sub.writeUInt32BE(28, 4); // length
  sub.writeUInt32BE(1, 12); // nGroups
  sub.writeUInt32BE(codePoint, 16); // startCharCode
  sub.writeUInt32BE(codePoint, 20); // endCharCode
  sub.writeUInt32BE(1, 24); // startGlyphID

  const cmapHeader = Buffer.alloc(12);
  cmapHeader.writeUInt16BE(1, 2); // numTables
  cmapHeader.writeUInt16BE(3, 4); // platformID
  cmapHeader.writeUInt16BE(10, 6); // encodingID 10 = full Unicode (astral)
  cmapHeader.writeUInt32BE(12, 8); // subtable offset
  const cmap = Buffer.concat([cmapHeader, sub]);

  return assembleTtf([
    ["head", head],
    ["maxp", maxp],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["cmap", cmap],
  ]);
}

// A single-contour SQUARE glyph (100,100)-(900,900), all corners on-curve. getGlyphPath should
// trace it as M + 3 L + Z.
function squareGlyf(): Buffer {
  const glyf = Buffer.alloc(34);
  glyf.writeInt16BE(1, 0); // numberOfContours
  glyf.writeInt16BE(100, 2); // xMin / yMin / xMax / yMax
  glyf.writeInt16BE(100, 4);
  glyf.writeInt16BE(900, 6);
  glyf.writeInt16BE(900, 8);
  glyf.writeUInt16BE(3, 10); // endPtsOfContours[0] = last point index
  glyf.writeUInt16BE(0, 12); // instructionLength
  [0x01, 0x01, 0x01, 0x01].forEach((f, i) => glyf.writeUInt8(f, 14 + i)); // all on-curve, long deltas
  [100, 0, 800, 0].forEach((d, i) => glyf.writeInt16BE(d, 18 + i * 2)); // x deltas
  [100, 800, 0, -800].forEach((d, i) => glyf.writeInt16BE(d, 26 + i * 2)); // y deltas
  return glyf;
}

// A single-contour glyph with ONE off-curve control point: on(0,0), off(500,1000), on(1000,0).
// getGlyphPath should trace it as M + one Q (through the control) + Z (the straight closing base).
function quadGlyf(): Buffer {
  const glyf = Buffer.alloc(30); // 29 bytes of data, padded to an even length for short loca
  glyf.writeInt16BE(1, 0); // numberOfContours
  glyf.writeInt16BE(0, 2); // bbox xMin / yMin / xMax / yMax
  glyf.writeInt16BE(0, 4);
  glyf.writeInt16BE(1000, 6);
  glyf.writeInt16BE(1000, 8);
  glyf.writeUInt16BE(2, 10); // endPtsOfContours[0]
  glyf.writeUInt16BE(0, 12); // instructionLength
  [0x01, 0x00, 0x01].forEach((f, i) => glyf.writeUInt8(f, 14 + i)); // on, OFF, on - all long deltas
  [0, 500, 500].forEach((d, i) => glyf.writeInt16BE(d, 17 + i * 2)); // x deltas
  [0, 1000, -1000].forEach((d, i) => glyf.writeInt16BE(d, 23 + i * 2)); // y deltas
  return glyf;
}

// Wraps a single outline glyph (glyph 1; glyph 0 is an empty .notdef) into a valid TTF, reachable
// via a format-12 cmap at `codePoint`. The glyf body is padded to an even length so the short loca
// offsets (stored halved) stay integral.
function wrapGlyphFont(glyf: Buffer, codePoint: number): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1000, 18); // unitsPerEm
  // head[50] indexToLocFormat stays 0 => short loca

  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(2, 4); // numGlyphs: .notdef + the outline glyph

  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(2, 34); // numberOfHMetrics

  const hmtx = Buffer.alloc(8);
  hmtx.writeUInt16BE(0, 0);
  hmtx.writeUInt16BE(1000, 4);

  // loca (short): byte offsets / 2. glyph0 empty (0..0), glyph1 spans 0..glyf.length.
  const loca = Buffer.alloc(6);
  loca.writeUInt16BE(0, 0);
  loca.writeUInt16BE(0, 2);
  loca.writeUInt16BE(glyf.length / 2, 4);

  // cmap format 12: codePoint -> glyph 1.
  const sub = Buffer.alloc(28);
  sub.writeUInt16BE(12, 0);
  sub.writeUInt32BE(28, 4);
  sub.writeUInt32BE(1, 12);
  sub.writeUInt32BE(codePoint, 16);
  sub.writeUInt32BE(codePoint, 20);
  sub.writeUInt32BE(1, 24);
  const cmapHeader = Buffer.alloc(12);
  cmapHeader.writeUInt16BE(1, 2);
  cmapHeader.writeUInt16BE(3, 4);
  cmapHeader.writeUInt16BE(10, 6);
  cmapHeader.writeUInt32BE(12, 8);
  const cmap = Buffer.concat([cmapHeader, sub]);

  return assembleTtf([
    ["head", head],
    ["maxp", maxp],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["cmap", cmap],
    ["loca", loca],
    ["glyf", glyf],
  ]);
}

// A TTF whose glyph 1 is a square outline (see squareGlyf), reachable at `codePoint`.
export function buildOutlineTtf(codePoint = 0x1f600): Buffer {
  return wrapGlyphFont(squareGlyf(), codePoint);
}

// A TTF whose glyph 1 has a quadratic curve (see quadGlyf), reachable at `codePoint`.
export function buildQuadTtf(codePoint = 0x1f600): Buffer {
  return wrapGlyphFont(quadGlyf(), codePoint);
}

// A COLR v0 / CPAL color font. Base glyph 1 (reached at `codePoint`) has two layers: the square
// glyph 2 in palette color 0 (red), then the curve glyph 3 in palette color 1 (blue). Glyphs 0
// and 1 have no outline of their own - the color comes entirely from the layers.
export function buildColorTtf(codePoint = 0x1f600): Buffer {
  // COLR v0: one base glyph (id 1) -> two layers {glyph 2, palette 0}, {glyph 3, palette 1}.
  const colr = Buffer.alloc(28);
  colr.writeUInt16BE(0, 0); // version
  colr.writeUInt16BE(1, 2); // numBaseGlyphRecords
  colr.writeUInt32BE(14, 4); // baseGlyphRecordsOffset
  colr.writeUInt32BE(20, 8); // layerRecordsOffset
  colr.writeUInt16BE(2, 12); // numLayerRecords
  colr.writeUInt16BE(1, 14); // baseGlyph[0].glyphID
  colr.writeUInt16BE(0, 16); // baseGlyph[0].firstLayerIndex
  colr.writeUInt16BE(2, 18); // baseGlyph[0].numLayers
  colr.writeUInt16BE(2, 20); // layer[0].glyphID
  colr.writeUInt16BE(0, 22); // layer[0].paletteIndex
  colr.writeUInt16BE(3, 24); // layer[1].glyphID
  colr.writeUInt16BE(1, 26); // layer[1].paletteIndex
  return colorFontShell(colr, codePoint);
}

// A COLR v1 color font: base glyph 1 (at `codePoint`) is a PaintColrLayers of two PaintGlyphs -
// glyph 2 filled SOLID (palette 0, red), glyph 3 filled with a LINEAR GRADIENT (palette 0 -> 1,
// red -> blue). Exercises the v1 paint-graph walk end to end.
export function buildColorV1Ttf(codePoint = 0x1f600): Buffer {
  const colr = Buffer.alloc(110);
  const u24 = (v: number, o: number): void => {
    colr.writeUInt8((v >> 16) & 0xff, o);
    colr.writeUInt8((v >> 8) & 0xff, o + 1);
    colr.writeUInt8(v & 0xff, o + 2);
  };

  colr.writeUInt16BE(1, 0); // version 1 (v0 record counts/offsets left 0)
  colr.writeUInt32BE(34, 14); // baseGlyphListOffset
  colr.writeUInt32BE(50, 18); // layerListOffset

  // BaseGlyphList @34: 1 record { glyphID 1 -> paint at rel offset 10 (COLR 44) }.
  colr.writeUInt32BE(1, 34); // numBaseGlyphPaintRecords
  colr.writeUInt16BE(1, 38); // glyphID
  colr.writeUInt32BE(10, 40); // paintOffset (rel to BaseGlyphList)

  // PaintColrLayers @44: 2 layers starting at LayerList index 0.
  colr.writeUInt8(1, 44); // format
  colr.writeUInt8(2, 45); // numLayers
  colr.writeUInt32BE(0, 46); // firstLayerIndex

  // LayerList @50: 2 paint offsets (rel to LayerList) -> PaintGlyphs at COLR 62 and 68.
  colr.writeUInt32BE(2, 50); // numLayers
  colr.writeUInt32BE(12, 54); // -> 62
  colr.writeUInt32BE(18, 58); // -> 68

  // PaintGlyph @62: glyph 2, fill at rel offset 12 (COLR 74 = PaintSolid).
  colr.writeUInt8(10, 62);
  u24(12, 63);
  colr.writeUInt16BE(2, 66); // glyphID

  // PaintGlyph @68: glyph 3, fill at rel offset 11 (COLR 79 = PaintLinearGradient).
  colr.writeUInt8(10, 68);
  u24(11, 69);
  colr.writeUInt16BE(3, 72); // glyphID

  // PaintSolid @74: palette 0, alpha 1.0.
  colr.writeUInt8(2, 74);
  colr.writeUInt16BE(0, 75); // paletteIndex
  colr.writeUInt16BE(16384, 77); // alpha F2Dot14 = 1.0

  // PaintLinearGradient @79: color line at rel offset 16 (COLR 95), p0 (0,0) -> p1 (0,100).
  colr.writeUInt8(4, 79);
  u24(16, 80);
  colr.writeInt16BE(0, 83); // x0
  colr.writeInt16BE(0, 85); // y0
  colr.writeInt16BE(0, 87); // x1
  colr.writeInt16BE(100, 89); // y1
  colr.writeInt16BE(1, 91); // x2 (rotation vector, unused by our axial mapping)
  colr.writeInt16BE(0, 93); // y2

  // ColorLine @95: pad, 2 stops - 0.0 palette 0 (red), 1.0 palette 1 (blue).
  colr.writeUInt8(0, 95); // extend = pad
  colr.writeUInt16BE(2, 96); // numStops
  colr.writeInt16BE(0, 98); // stop0 offset 0.0
  colr.writeUInt16BE(0, 100); // stop0 paletteIndex
  colr.writeInt16BE(16384, 102); // stop0 alpha 1.0
  colr.writeInt16BE(16384, 104); // stop1 offset 1.0
  colr.writeUInt16BE(1, 106); // stop1 paletteIndex
  colr.writeInt16BE(16384, 108); // stop1 alpha 1.0

  return colorFontShell(colr, codePoint);
}

// Wraps a COLR table (v0 or v1) into a full color font: 4 glyphs (.notdef, an empty base at
// `codePoint`, then a square and a curve as layer outlines) plus a CPAL palette [red, blue].
function colorFontShell(colr: Buffer, codePoint: number): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1000, 18); // unitsPerEm

  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(4, 4); // numGlyphs: .notdef, base, 2 layer glyphs

  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(4, 34); // numberOfHMetrics

  const hmtx = Buffer.alloc(16);
  hmtx.writeUInt16BE(1000, 4); // base glyph advance (the others reuse it via last-advance rule)

  // glyf: glyph 0 empty, glyph 1 empty (base), glyph 2 square (34 bytes), glyph 3 curve (30 bytes).
  const glyf = Buffer.concat([squareGlyf(), quadGlyf()]);

  // loca (short, offsets / 2): [g0, g1, g2, g3, end] = byte [0, 0, 0, 34, 64].
  const loca = Buffer.alloc(10);
  [0, 0, 0, 34, 64].forEach((byteOffset, i) => loca.writeUInt16BE(byteOffset / 2, i * 2));

  // cmap format 12: codePoint -> base glyph 1.
  const sub = Buffer.alloc(28);
  sub.writeUInt16BE(12, 0);
  sub.writeUInt32BE(28, 4);
  sub.writeUInt32BE(1, 12);
  sub.writeUInt32BE(codePoint, 16);
  sub.writeUInt32BE(codePoint, 20);
  sub.writeUInt32BE(1, 24); // startGlyphID = 1 (the base glyph)
  const cmapHeader = Buffer.alloc(12);
  cmapHeader.writeUInt16BE(1, 2);
  cmapHeader.writeUInt16BE(3, 4);
  cmapHeader.writeUInt16BE(10, 6);
  cmapHeader.writeUInt32BE(12, 8);
  const cmap = Buffer.concat([cmapHeader, sub]);

  // CPAL v0: palette 0 = [red, blue]. Color records are BGRA bytes.
  const cpal = Buffer.alloc(22);
  cpal.writeUInt16BE(0, 0); // version
  cpal.writeUInt16BE(2, 2); // numPaletteEntries
  cpal.writeUInt16BE(1, 4); // numPalettes
  cpal.writeUInt16BE(2, 6); // numColorRecords
  cpal.writeUInt32BE(14, 8); // colorRecordsArrayOffset
  cpal.writeUInt16BE(0, 12); // colorRecordIndices[0]
  [0x00, 0x00, 0xff, 0xff].forEach((byte, i) => cpal.writeUInt8(byte, 14 + i)); // red  (B,G,R,A)
  [0xff, 0x00, 0x00, 0xff].forEach((byte, i) => cpal.writeUInt8(byte, 18 + i)); // blue (B,G,R,A)

  return assembleTtf([
    ["head", head],
    ["maxp", maxp],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["cmap", cmap],
    ["loca", loca],
    ["glyf", glyf],
    ["COLR", colr],
    ["CPAL", cpal],
  ]);
}

// A metric-only TTF whose cmap has TWO Unicode subtables: a (3,1) format-4 for the BMP (maps 'A'
// -> glyph 1) and a (3,10) format-12 for astral code points (maps `astral` -> glyph 2). Guards that
// the parser reads BOTH subtables, not just the first - otherwise astral chars resolve to .notdef.
export function buildDualCmapTtf(astral = 0x1f600): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1000, 18);

  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(3, 4); // .notdef, 'A', astral

  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(3, 34);

  const hmtx = Buffer.alloc(12);
  [0, 500, 700].forEach((a, i) => hmtx.writeUInt16BE(a, i * 4));

  // format-4 subtable (32 bytes): one segment {0x41 -> glyph 1} plus the 0xFFFF terminator.
  const f4 = Buffer.alloc(32);
  f4.writeUInt16BE(4, 0); // format
  f4.writeUInt16BE(32, 2); // length
  f4.writeUInt16BE(4, 6); // segCountX2 (2 segments)
  [0x41, 0xffff].forEach((v, i) => f4.writeUInt16BE(v, 14 + i * 2)); // endCodes
  [0x41, 0xffff].forEach((v, i) => f4.writeUInt16BE(v, 20 + i * 2)); // startCodes (after +2 pad)
  [65472, 1].forEach((v, i) => f4.writeUInt16BE(v, 24 + i * 2)); // idDeltas: 0x41 + 65472 = 1 (mod 2^16)

  // format-12 subtable (28 bytes): one group {astral -> glyph 2}.
  const f12 = Buffer.alloc(28);
  f12.writeUInt16BE(12, 0);
  f12.writeUInt32BE(28, 4);
  f12.writeUInt32BE(1, 12);
  f12.writeUInt32BE(astral, 16);
  f12.writeUInt32BE(astral, 20);
  f12.writeUInt32BE(2, 24); // startGlyphID = 2

  // cmap header with two subtable records: (3,1) -> f4 at 20, (3,10) -> f12 at 52.
  const header = Buffer.alloc(20);
  header.writeUInt16BE(2, 2); // numTables
  header.writeUInt16BE(3, 4); // record 0: platformID
  header.writeUInt16BE(1, 6); // record 0: encodingID (BMP)
  header.writeUInt32BE(20, 8); // record 0: subtable offset
  header.writeUInt16BE(3, 12); // record 1: platformID
  header.writeUInt16BE(10, 14); // record 1: encodingID (full Unicode)
  header.writeUInt32BE(52, 16); // record 1: subtable offset
  const cmap = Buffer.concat([header, f4, f12]);

  return assembleTtf([
    ["head", head],
    ["maxp", maxp],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["cmap", cmap],
  ]);
}

// Lays the given tables into a valid sfnt: offset table, 16-byte directory entries, then the
// 4-byte-aligned table bodies.
function assembleTtf(tables: [string, Buffer][]): Buffer {
  const offsetTable = Buffer.alloc(12);
  offsetTable.writeUInt32BE(0x00010000, 0);
  offsetTable.writeUInt16BE(tables.length, 4);

  const dir = Buffer.alloc(16 * tables.length);
  const body: Buffer[] = [];
  let offset = 12 + dir.length;
  tables.forEach(([tag, buf], i) => {
    dir.write(tag, i * 16, "latin1");
    dir.writeUInt32BE(offset, i * 16 + 8);
    dir.writeUInt32BE(buf.length, i * 16 + 12);
    body.push(buf);
    offset += buf.length;
    const pad = (4 - (buf.length % 4)) % 4;
    if (pad) {
      body.push(Buffer.alloc(pad));
      offset += pad;
    }
  });

  return Buffer.concat([offsetTable, dir, ...body]);
}

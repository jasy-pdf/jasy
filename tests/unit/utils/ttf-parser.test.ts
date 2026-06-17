import { describe, it, expect } from "vitest";
import { TTFParser } from "../../../src/lib/utils/ttf-parser";

// A minimal but valid TTF with the 5 metric tables and 4 glyphs (.notdef, 'A', 'B', ' '),
// so we can assert exact widths without shipping a real (MB-sized) font binary.
function buildTestTtf(): Buffer {
  const head = Buffer.alloc(54);
  head.writeUInt16BE(1000, 18); // unitsPerEm

  const maxp = Buffer.alloc(6);
  maxp.writeUInt16BE(4, 4); // numGlyphs

  const hhea = Buffer.alloc(36);
  hhea.writeUInt16BE(4, 34); // numberOfHMetrics

  const advances = [0, 500, 700, 250]; // .notdef, A, B, space
  const hmtx = Buffer.alloc(advances.length * 4);
  advances.forEach((a, i) => hmtx.writeUInt16BE(a, i * 4)); // {advanceWidth, lsb=0}

  // cmap format 4: segments {space}, {A..B}, {0xFFFF terminator}. idDelta maps each char.
  const sub = Buffer.alloc(40);
  sub.writeUInt16BE(4, 0); // format
  sub.writeUInt16BE(40, 2); // length
  sub.writeUInt16BE(6, 6); // segCountX2 (3 segments)
  const endCodes = 14;
  const startCodes = endCodes + 6 + 2; // +2 reservedPad
  const idDeltas = startCodes + 6;
  [0x20, 0x42, 0xffff].forEach((v, i) => sub.writeUInt16BE(v, endCodes + i * 2));
  [0x20, 0x41, 0xffff].forEach((v, i) => sub.writeUInt16BE(v, startCodes + i * 2));
  [65507, 65472, 1].forEach((v, i) => sub.writeUInt16BE(v, idDeltas + i * 2)); // (c+delta)&0xffff
  // idRangeOffsets left 0

  const cmapHeader = Buffer.alloc(12);
  cmapHeader.writeUInt16BE(1, 2); // numTables
  cmapHeader.writeUInt16BE(3, 4); // platformID (Windows)
  cmapHeader.writeUInt16BE(1, 6); // encodingID (BMP)
  cmapHeader.writeUInt32BE(12, 8); // subtable offset
  const cmap = Buffer.concat([cmapHeader, sub]);

  const tables: [string, Buffer][] = [
    ["head", head],
    ["maxp", maxp],
    ["hhea", hhea],
    ["hmtx", hmtx],
    ["cmap", cmap],
  ];

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

describe("TTFParser", () => {
  const font = new TTFParser(buildTestTtf());

  it("reads unitsPerEm from head", () => {
    expect(font.unitsPerEm).toBe(1000);
  });

  it("maps characters to glyphs via cmap (0 for the unmapped)", () => {
    expect(font.getGlyphIndex(0x41)).toBe(1); // A
    expect(font.getGlyphIndex(0x42)).toBe(2); // B
    expect(font.getGlyphIndex(0x20)).toBe(3); // space
    expect(font.getGlyphIndex(0x2603)).toBe(0); // snowman → .notdef
  });

  it("reads advance widths from hmtx", () => {
    expect(font.getAdvanceWidth(1)).toBe(500);
    expect(font.getAdvanceWidth(2)).toBe(700);
  });

  it("computes string width scaled by fontSize / unitsPerEm", () => {
    expect(font.getStringWidth("A", 1000)).toBe(500);
    expect(font.getStringWidth("A", 12)).toBeCloseTo(6, 5); // 500/1000 * 12
    expect(font.getStringWidth("AB", 12)).toBeCloseTo(14.4, 5); // (500+700)/1000 * 12
    expect(font.getStringWidth("A B", 12)).toBeCloseTo((500 + 250 + 700) / 1000 * 12, 5);
  });

  it("throws on a missing required table", () => {
    expect(() => new TTFParser(Buffer.alloc(12))).toThrow(/missing required table/);
  });
});

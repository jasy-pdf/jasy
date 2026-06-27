// Builds a subset TrueType font that KEEPS the original glyph ids: the PDF content stream emits
// original gids and /W + CIDToGIDMap=Identity stay valid, so only the font program shrinks. We drop
// the `glyf` outlines of unused glyphs (the bulk of the file) and rebuild `loca`; every other table
// is copied verbatim. The used-glyph set is closed over composite-glyph components first, so a glyph
// built from others (e.g. "ä") keeps its parts. Fonts without `glyf`/`loca` (CFF/OTF) pass through.
import {
  concatBytes,
  i16,
  latin1FromBytes,
  u16,
  u32,
  wi16,
  wu16,
  wu32,
  writeLatin1,
} from "./bytes.ts";

interface Dir {
  offset: number;
  length: number;
}

const wrap32 = (n: number) => n >>> 0;

/** TrueType table checksum: sum of big-endian uint32 over the 4-byte-padded table data. */
function checksum(buf: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) sum = wrap32(sum + u32(buf, i));
  return sum;
}

/** Right-pad to a 4-byte boundary (table data is aligned in the sfnt). */
function pad4(buf: Uint8Array): Uint8Array {
  const rem = buf.length % 4;
  return rem === 0 ? buf : concatBytes([buf, new Uint8Array(4 - rem)]);
}

export function subsetTTF(data: Uint8Array, used: Set<number>): Uint8Array {
  const numTables = u16(data, 4);
  const dir = new Map<string, Dir>();
  let p = 12;
  for (let i = 0; i < numTables; i++) {
    dir.set(latin1FromBytes(data.subarray(p, p + 4)), {
      offset: u32(data, p + 8),
      length: u32(data, p + 12),
    });
    p += 16;
  }

  // No glyf/loca → not a TrueType-outline font we can subset this way; hand it back unchanged.
  if (!dir.has("glyf") || !dir.has("loca") || !dir.has("head") || !dir.has("maxp")) return data;

  const headOff = dir.get("head")!.offset;
  const longLoca = i16(data, headOff + 50) === 1;
  const numGlyphs = u16(data, dir.get("maxp")!.offset + 4);
  const locaOff = dir.get("loca")!.offset;
  const glyfOff = dir.get("glyf")!.offset;

  // Original glyph offsets (numGlyphs + 1 entries; short loca stores half-offsets).
  const loca: number[] = [];
  for (let g = 0; g <= numGlyphs; g++) {
    loca.push(longLoca ? u32(data, locaOff + g * 4) : u16(data, locaOff + g * 2) * 2);
  }
  const glyphBytes = (g: number) => data.subarray(glyfOff + loca[g], glyfOff + loca[g + 1]);

  // Close the used set over composite components (and always keep .notdef = gid 0).
  const keep = new Set<number>([0]);
  const stack = [...used, 0];
  while (stack.length) {
    const g = stack.pop()!;
    if (g < 0 || g >= numGlyphs || keep.has(g)) continue;
    keep.add(g);
    const gd = glyphBytes(g);
    if (gd.length >= 10 && i16(gd, 0) < 0) {
      // Composite glyph: walk the component records to collect the referenced gids.
      let q = 10; // numberOfContours(2) + xMin/yMin/xMax/yMax(8)
      for (;;) {
        const flags = u16(gd, q);
        stack.push(u16(gd, q + 2));
        q += 4 + (flags & 0x0001 ? 4 : 2); // ARG_1_AND_2_ARE_WORDS
        if (flags & 0x0008)
          q += 2; // WE_HAVE_A_SCALE
        else if (flags & 0x0040)
          q += 4; // WE_HAVE_AN_X_AND_Y_SCALE
        else if (flags & 0x0080) q += 8; // WE_HAVE_A_TWO_BY_TWO
        if (!(flags & 0x0020)) break; // MORE_COMPONENTS
      }
    }
  }

  // Rebuild glyf (kept glyphs only, original numbering) + a long-format loca.
  const parts: Uint8Array[] = [];
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  let off = 0;
  for (let g = 0; g < numGlyphs; g++) {
    wu32(newLoca, off, g * 4);
    if (keep.has(g)) {
      let gd: Uint8Array = glyphBytes(g).slice(); // copy: padded + concatenated, must not view `data`
      if (gd.length % 2 === 1) gd = concatBytes([gd, new Uint8Array(1)]); // keep offsets even
      parts.push(gd);
      off += gd.length;
    }
  }
  wu32(newLoca, off, numGlyphs * 4);
  const newGlyf = concatBytes(parts);

  // head copy with indexToLocFormat = 1 (long); checkSumAdjustment zeroed, fixed up at the end.
  const newHead = data.slice(headOff, headOff + dir.get("head")!.length);
  wi16(newHead, 1, 50);
  wu32(newHead, 0, 8);

  // Tables a PDF-embedded CIDFontType2 doesn't need - layout (GSUB/GPOS…), hinting hints and the
  // signature are dead weight; dropping them is most of the size win. `post` is reduced to format 3
  // (header only, no glyph names). cmap/name/OS-2 are kept for a still-valid standalone font.
  const DROP = new Set([
    "GSUB",
    "GPOS",
    "GDEF",
    "BASE",
    "JSTF",
    "kern",
    "DSIG",
    "hdmx",
    "LTSH",
    "VDMX",
    "PCLT",
    "gasp",
  ]);

  const tags = [...dir.keys()].filter((t) => !DROP.has(t)).sort();
  const tables = tags.map((tag) => {
    let body: Uint8Array;
    if (tag === "glyf") body = newGlyf;
    else if (tag === "loca") body = newLoca;
    else if (tag === "head") body = newHead;
    else if (tag === "post") {
      // Keep the 32-byte header, force version 3.0 (drops the per-glyph name list).
      body = data.slice(dir.get("post")!.offset, dir.get("post")!.offset + 32);
      wu32(body, 0x00030000, 0);
    } else {
      const d = dir.get(tag)!;
      body = data.subarray(d.offset, d.offset + d.length);
    }
    return { tag, body, length: body.length };
  });

  // sfnt: offset table + table directory + 4-byte-aligned table data.
  const n = tables.length;
  const maxPow2 = 1 << Math.floor(Math.log2(n));
  const out: Uint8Array[] = [];
  const offsetTable = new Uint8Array(12);
  wu32(offsetTable, u32(data, 0), 0); // sfntVersion
  wu16(offsetTable, n, 4);
  wu16(offsetTable, maxPow2 * 16, 6); // searchRange
  wu16(offsetTable, Math.floor(Math.log2(n)), 8); // entrySelector
  wu16(offsetTable, n * 16 - maxPow2 * 16, 10); // rangeShift
  out.push(offsetTable);

  const dirBuf = new Uint8Array(n * 16);
  let tableOffset = 12 + n * 16;
  const dataBufs: Uint8Array[] = [];
  tables.forEach((t, i) => {
    const padded = pad4(t.body);
    writeLatin1(dirBuf, t.tag, i * 16);
    wu32(dirBuf, checksum(padded), i * 16 + 4);
    wu32(dirBuf, tableOffset, i * 16 + 8);
    wu32(dirBuf, t.length, i * 16 + 12); // real (unpadded) length
    tableOffset += padded.length;
    dataBufs.push(padded);
  });
  out.push(dirBuf, ...dataBufs);

  const font = concatBytes(out);

  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(whole font). Locate head in the assembled font.
  const headIdx = tables.findIndex((t) => t.tag === "head");
  const headPos = u32(dirBuf, headIdx * 16 + 8);
  wu32(font, wrap32(0xb1b0afba - checksum(font)), headPos + 8);
  return font;
}

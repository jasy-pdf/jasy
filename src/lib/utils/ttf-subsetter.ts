// Builds a subset TrueType font that KEEPS the original glyph ids: the PDF content stream emits
// original gids and /W + CIDToGIDMap=Identity stay valid, so only the font program shrinks. We drop
// the `glyf` outlines of unused glyphs (the bulk of the file) and rebuild `loca`; every other table
// is copied verbatim. The used-glyph set is closed over composite-glyph components first, so a glyph
// built from others (e.g. "ä") keeps its parts. Fonts without `glyf`/`loca` (CFF/OTF) pass through.

interface Dir {
  offset: number;
  length: number;
}

const u32 = (n: number) => n >>> 0;

/** TrueType table checksum: sum of big-endian uint32 over the 4-byte-padded table data. */
function checksum(buf: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) sum = u32(sum + buf.readUInt32BE(i));
  return sum;
}

/** Right-pad to a 4-byte boundary (table data is aligned in the sfnt). */
function pad4(buf: Buffer): Buffer {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}

export function subsetTTF(data: Buffer, used: Set<number>): Buffer {
  const numTables = data.readUInt16BE(4);
  const dir = new Map<string, Dir>();
  let p = 12;
  for (let i = 0; i < numTables; i++) {
    dir.set(data.toString("latin1", p, p + 4), {
      offset: data.readUInt32BE(p + 8),
      length: data.readUInt32BE(p + 12),
    });
    p += 16;
  }

  // No glyf/loca → not a TrueType-outline font we can subset this way; hand it back unchanged.
  if (!dir.has("glyf") || !dir.has("loca") || !dir.has("head") || !dir.has("maxp")) return data;

  const headOff = dir.get("head")!.offset;
  const longLoca = data.readInt16BE(headOff + 50) === 1;
  const numGlyphs = data.readUInt16BE(dir.get("maxp")!.offset + 4);
  const locaOff = dir.get("loca")!.offset;
  const glyfOff = dir.get("glyf")!.offset;

  // Original glyph offsets (numGlyphs + 1 entries; short loca stores half-offsets).
  const loca: number[] = [];
  for (let g = 0; g <= numGlyphs; g++) {
    loca.push(
      longLoca ? data.readUInt32BE(locaOff + g * 4) : data.readUInt16BE(locaOff + g * 2) * 2,
    );
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
    if (gd.length >= 10 && gd.readInt16BE(0) < 0) {
      // Composite glyph: walk the component records to collect the referenced gids.
      let q = 10; // numberOfContours(2) + xMin/yMin/xMax/yMax(8)
      for (;;) {
        const flags = gd.readUInt16BE(q);
        stack.push(gd.readUInt16BE(q + 2));
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
  const parts: Buffer[] = [];
  const newLoca = Buffer.alloc((numGlyphs + 1) * 4);
  let off = 0;
  for (let g = 0; g < numGlyphs; g++) {
    newLoca.writeUInt32BE(off, g * 4);
    if (keep.has(g)) {
      let gd = Buffer.from(glyphBytes(g));
      if (gd.length % 2 === 1) gd = Buffer.concat([gd, Buffer.alloc(1)]); // keep offsets even
      parts.push(gd);
      off += gd.length;
    }
  }
  newLoca.writeUInt32BE(off, numGlyphs * 4);
  const newGlyf = Buffer.concat(parts);

  // head copy with indexToLocFormat = 1 (long); checkSumAdjustment zeroed, fixed up at the end.
  const newHead = Buffer.from(data.subarray(headOff, headOff + dir.get("head")!.length));
  newHead.writeInt16BE(1, 50);
  newHead.writeUInt32BE(0, 8);

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
    let body: Buffer;
    if (tag === "glyf") body = newGlyf;
    else if (tag === "loca") body = newLoca;
    else if (tag === "head") body = newHead;
    else if (tag === "post") {
      // Keep the 32-byte header, force version 3.0 (drops the per-glyph name list).
      body = Buffer.from(data.subarray(dir.get("post")!.offset, dir.get("post")!.offset + 32));
      body.writeUInt32BE(0x00030000, 0);
    } else {
      const d = dir.get(tag)!;
      body = data.subarray(d.offset, d.offset + d.length);
    }
    return { tag, body, length: body.length };
  });

  // sfnt: offset table + table directory + 4-byte-aligned table data.
  const n = tables.length;
  const maxPow2 = 1 << Math.floor(Math.log2(n));
  const out: Buffer[] = [];
  const offsetTable = Buffer.alloc(12);
  offsetTable.writeUInt32BE(data.readUInt32BE(0), 0); // sfntVersion
  offsetTable.writeUInt16BE(n, 4);
  offsetTable.writeUInt16BE(maxPow2 * 16, 6); // searchRange
  offsetTable.writeUInt16BE(Math.floor(Math.log2(n)), 8); // entrySelector
  offsetTable.writeUInt16BE(n * 16 - maxPow2 * 16, 10); // rangeShift
  out.push(offsetTable);

  const dirBuf = Buffer.alloc(n * 16);
  let tableOffset = 12 + n * 16;
  const dataBufs: Buffer[] = [];
  tables.forEach((t, i) => {
    const padded = pad4(t.body);
    dirBuf.write(t.tag, i * 16, 4, "latin1");
    dirBuf.writeUInt32BE(checksum(padded), i * 16 + 4);
    dirBuf.writeUInt32BE(tableOffset, i * 16 + 8);
    dirBuf.writeUInt32BE(t.length, i * 16 + 12); // real (unpadded) length
    tableOffset += padded.length;
    dataBufs.push(padded);
  });
  out.push(dirBuf, ...dataBufs);

  const font = Buffer.concat(out);

  // head.checkSumAdjustment = 0xB1B0AFBA - checksum(whole font). Locate head in the assembled font.
  const headIdx = tables.findIndex((t) => t.tag === "head");
  const headPos = dirBuf.readUInt32BE(headIdx * 16 + 8);
  font.writeUInt32BE(u32(0xb1b0afba - checksum(font)), headPos + 8);
  return font;
}

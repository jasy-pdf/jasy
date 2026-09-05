import { WoffError } from "./woff.ts";

/**
 * WOFF2 -> plain sfnt bytes.
 *
 * WOFF2 is not "WOFF1 with a better compressor". Two things make it a different piece of work:
 *
 * 1. **Brotli**, which `fflate` does not do and which is not a thing to hand-roll - the decoder needs
 *    Brotli's built-in 120 KB static dictionary. So it is bought, like `fflate` for deflate, and
 *    LAZILY imported so a document without a WOFF2 never loads it (the bargain `jimp` already makes).
 *    fontkit - react-pdf's font engine - depends on the same package.
 * 2. **The `glyf` table is REWRITTEN**, not merely compressed: points are triplet-encoded across five
 *    separate streams, composites and instructions in two more. Rebuilding `glyf` + `loca` from that
 *    is most of this file, and it is what nothing downstream should ever have to know about.
 *
 * Everything here funnels into `woff2ToSfnt`, which `TTFParser` calls at the one point every font
 * path meets - so a file, raw bytes, a URL and a browser upload all get it for free.
 */

const SIGNATURE = 0x774f4632; // 'wOF2'
const HEADER = 48;

/** The 63 tags WOFF2 can name by index instead of spelling out. Order is normative. */
const KNOWN_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
];

const be16 = (b: Uint8Array, at: number): number => (b[at]! << 8) | b[at + 1]!;
const be32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

export const isWoff2 = (bytes: Uint8Array): boolean =>
  bytes.length >= HEADER && be32(bytes, 0) === SIGNATURE;

/** A cursor over one of the sub-streams; every read moves it on. */
class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}

  u8(): number {
    if (this.offset >= this.bytes.length) throw new WoffError("the WOFF2 data ends mid-value");
    return this.bytes[this.offset++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  i16(): number {
    const n = this.u16();
    return n & 0x8000 ? n - 0x10000 : n;
  }
  u32(): number {
    return ((this.u16() << 16) | this.u16()) >>> 0;
  }
  take(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new WoffError("the WOFF2 data ends mid-table");
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  /** Up to five bytes, seven bits each, high bit continues. Used for every length in the directory. */
  base128(): number {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      // A leading zero byte, or a value past 2^32, is malformed rather than merely unusual.
      if (i === 0 && byte === 0x80) throw new WoffError("a WOFF2 length has a leading zero");
      if (value > 0x01ffffff) throw new WoffError("a WOFF2 length overflows 32 bits");
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new WoffError("a WOFF2 length runs past five bytes");
  }

  /** WOFF2's short-count encoding: one byte for 0..252, otherwise a two- or three-byte form. */
  count255(): number {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 254) return this.u8() + 253 * 2;
    if (code === 255) return this.u8() + 253;
    return code;
  }
}

interface Entry {
  tag: string;
  transformed: boolean;
  origLength: number;
  transformLength: number;
}

function readDirectory(reader: Reader, numTables: number): Entry[] {
  const entries: Entry[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = reader.u8();
    const index = flags & 0x3f;
    const version = (flags >> 6) & 0x03;
    const tag =
      index === 0x3f
        ? String.fromCharCode(reader.u8(), reader.u8(), reader.u8(), reader.u8())
        : (KNOWN_TAGS[index] ?? "");
    if (!tag)
      throw new WoffError(`the WOFF2 table directory names an unknown table (index ${index})`);

    const origLength = reader.base128();
    // The inversion is real and easy to get backwards: for `glyf` and `loca` the NULL transform is
    // version 3, for every other table it is version 0.
    const nullTransform = tag === "glyf" || tag === "loca" ? version === 3 : version === 0;
    const transformed = !nullTransform;
    const transformLength = transformed ? reader.base128() : origLength;
    entries.push({ tag, transformed, origLength, transformLength });
  }
  return entries;
}

/**
 * The 128 point encodings of the triplet format (WOFF2 §5.2), built from the ranges the spec lays
 * out rather than pasted as a wall of numbers - the structure is the documentation.
 */
interface Triplet {
  bytes: number;
  xBits: number;
  yBits: number;
  dx: number;
  dy: number;
  xSign: number;
  ySign: number;
}

const TRIPLETS: Triplet[] = (() => {
  const out: Triplet[] = [];
  const sign = (bit: number) => (bit ? 1 : -1);
  // 0..9: y only, 8 bits, dy stepping by 256 every second entry, sign alternating.
  for (let i = 0; i < 10; i++) {
    out.push({
      bytes: 1,
      xBits: 0,
      yBits: 8,
      dx: 0,
      dy: (i >> 1) * 256,
      xSign: 0,
      ySign: sign(i & 1),
    });
  }
  // 10..19: the same, x only.
  for (let i = 0; i < 10; i++) {
    out.push({
      bytes: 1,
      xBits: 8,
      yBits: 0,
      dx: (i >> 1) * 256,
      dy: 0,
      xSign: sign(i & 1),
      ySign: 0,
    });
  }
  // 20..83: both axes, 4 bits each in one byte - 4 x-bases x 4 y-bases x 4 sign pairs.
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      for (let c = 0; c < 4; c++) {
        out.push({
          bytes: 1,
          xBits: 4,
          yBits: 4,
          dx: 1 + a * 16,
          dy: 1 + b * 16,
          xSign: sign(c & 1),
          ySign: sign(c & 2),
        });
      }
    }
  }
  // 84..119: both axes, 8 bits each - 3 x-bases x 3 y-bases x 4 sign pairs.
  for (let a = 0; a < 3; a++) {
    for (let b = 0; b < 3; b++) {
      for (let c = 0; c < 4; c++) {
        out.push({
          bytes: 2,
          xBits: 8,
          yBits: 8,
          dx: 1 + a * 256,
          dy: 1 + b * 256,
          xSign: sign(c & 1),
          ySign: sign(c & 2),
        });
      }
    }
  }
  // 120..123: 12 bits each, 124..127: 16 bits each. No base, sign pairs only.
  for (const [bits, bytes] of [
    [12, 3],
    [16, 4],
  ] as const) {
    for (let c = 0; c < 4; c++) {
      out.push({
        bytes,
        xBits: bits,
        yBits: bits,
        dx: 0,
        dy: 0,
        xSign: sign(c & 1),
        ySign: sign(c & 2),
      });
    }
  }
  return out;
})();

/** A growable big-endian writer - the reconstructed `glyf` is built into one. */
class Writer {
  private buffer = new Uint8Array(1024);
  length = 0;

  private room(n: number): void {
    if (this.length + n <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + n) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(this.buffer.subarray(0, this.length));
    this.buffer = bigger;
  }
  u8(v: number): void {
    this.room(1);
    this.buffer[this.length++] = v & 0xff;
  }
  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }
  i16(v: number): void {
    this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v: number): void {
    this.u16(Math.floor(v / 0x10000));
    this.u16(v & 0xffff);
  }
  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buffer.set(b, this.length);
    this.length += b.length;
  }
  /** Pads to a four-byte boundary, which every sfnt table offset must sit on. */
  align(): void {
    while (this.length % 4 !== 0) this.u8(0);
  }
  done(): Uint8Array {
    return this.buffer.subarray(0, this.length);
  }
}

/** What the glyf transform hands back: the rebuilt tables, in sfnt form. */
interface Outlines {
  glyf: Uint8Array;
  loca: Uint8Array;
  indexToLocFormat: number;
}

/**
 * Rebuilds `glyf` and `loca` from the transformed table.
 *
 * The transformed form splits one glyph across seven streams: how many contours, how many points per
 * contour, one flag byte per point, the coordinates themselves, composite descriptions, bounding
 * boxes and hinting instructions. Reading it means walking all seven in lockstep.
 */
function rebuildOutlines(data: Uint8Array): Outlines {
  const head = new Reader(data);
  head.u32(); // version
  const numGlyphs = head.u16();
  const indexFormat = head.u16();
  const sizes = [0, 0, 0, 0, 0, 0, 0].map(() => head.u32());
  const [nContourSize, nPointsSize, flagSize, glyphSize, compositeSize, bboxSize, instructionSize] =
    sizes as [number, number, number, number, number, number, number];

  let at = head.offset;
  const slice = (n: number): Reader => {
    const r = new Reader(data.subarray(at, at + n));
    at += n;
    return r;
  };
  const nContours = slice(nContourSize);
  const nPoints = slice(nPointsSize);
  const flags = slice(flagSize);
  const glyphs = slice(glyphSize);
  const composites = slice(compositeSize);
  const bboxes = slice(bboxSize);
  const instructions = slice(instructionSize);

  // The bbox stream opens with one bit per glyph: is its bounding box stored, or to be computed?
  const bitmapBytes = Math.ceil(numGlyphs / 8);
  const bitmap = bboxes.take(bitmapBytes);
  const hasBbox = (i: number): boolean => ((bitmap[i >> 3]! >> (7 - (i & 7))) & 1) === 1;

  const glyf = new Writer();
  const offsets: number[] = [0];

  for (let g = 0; g < numGlyphs; g++) {
    const contours = nContours.i16();

    if (contours === 0) {
      // An empty glyph occupies no bytes at all; `loca` says so by repeating the offset.
      offsets.push(glyf.length);
      continue;
    }

    if (contours < 0) {
      // Composite: copied through verbatim, but its length is only known by walking the flags.
      const start = composites.offset;
      let more = true;
      let haveInstructions = false;
      while (more) {
        const flag = composites.u16();
        composites.u16(); // glyph index
        more = (flag & 0x0020) !== 0;
        haveInstructions ||= (flag & 0x0100) !== 0;
        composites.take(flag & 0x0001 ? 4 : 2); // arguments
        if (flag & 0x0008) composites.take(2);
        else if (flag & 0x0040) composites.take(4);
        else if (flag & 0x0080) composites.take(8);
      }
      const body = composites.bytes.subarray(start, composites.offset);
      const instructionLength = haveInstructions ? glyphs.count255() : 0;

      glyf.i16(-1);
      if (!hasBbox(g)) {
        throw new WoffError(`composite glyph ${g} has no bounding box, which WOFF2 requires`);
      }
      writeBbox(glyf, bboxes, true, null);
      glyf.bytes(body);
      if (haveInstructions) {
        glyf.u16(instructionLength);
        glyf.bytes(instructions.take(instructionLength));
      }
      glyf.align();
      offsets.push(glyf.length);
      continue;
    }

    // Simple glyph: point counts per contour, then one flag and one coordinate pair per point.
    const endPoints: number[] = [];
    let total = 0;
    for (let c = 0; c < contours; c++) {
      total += nPoints.count255();
      endPoints.push(total - 1);
    }

    const xs: number[] = [];
    const ys: number[] = [];
    const onCurve: boolean[] = [];
    let x = 0;
    let y = 0;
    for (let p = 0; p < total; p++) {
      const flag = flags.u8();
      // The high bit is the ON-curve marker; the low seven index the triplet table.
      onCurve.push((flag & 0x80) === 0);
      const t = TRIPLETS[flag & 0x7f]!;
      const raw = glyphs.take(t.bytes);
      // The bytes are one big-endian number: the x value in the HIGH `xBits`, y in the low `yBits`.
      // Plain arithmetic rather than shifts, because 16+16 bits overflows a signed 32-bit shift.
      let bits = 0;
      for (const byte of raw) bits = bits * 256 + byte;
      const yScale = 2 ** t.yBits;
      x += t.xSign * (t.dx + (t.xBits === 0 ? 0 : Math.floor(bits / yScale)));
      y += t.ySign * (t.dy + (t.yBits === 0 ? 0 : bits % yScale));
      xs.push(x);
      ys.push(y);
    }

    const instructionLength = glyphs.count255();

    glyf.i16(contours);
    writeBbox(glyf, bboxes, hasBbox(g), { xs, ys });
    for (const end of endPoints) glyf.u16(end);
    glyf.u16(instructionLength);
    glyf.bytes(instructions.take(instructionLength));
    writePoints(glyf, xs, ys, onCurve);
    glyf.align();
    offsets.push(glyf.length);
  }

  // The format is decided by what we actually produced, not by what the source used. Our glyf can be
  // LARGER than the original - we do not emit the REPEAT flag - so a font that fitted the short form
  // (offsets/2, up to 131070 bytes) may no longer, and writing it short would truncate in silence.
  // `align()` pads to four bytes, so every offset is even and the short form stays legal below that.
  const last = offsets[offsets.length - 1]!;
  const format = indexFormat === 0 && last <= 0x1fffe ? 0 : 1;
  const table = glyf.done();
  return { glyf: table, loca: writeLoca(offsets, format), indexToLocFormat: format };
}

/** The stored bounding box, or the one computed from the points - a simple glyph may omit it. */
function writeBbox(
  out: Writer,
  bboxes: Reader,
  stored: boolean,
  points: { xs: number[]; ys: number[] } | null,
): void {
  if (stored) {
    out.bytes(bboxes.take(8));
    return;
  }
  if (!points || points.xs.length === 0) {
    out.i16(0);
    out.i16(0);
    out.i16(0);
    out.i16(0);
    return;
  }
  // A loop, not `Math.min(...xs)`: spreading tens of thousands of arguments blows the call stack,
  // and a glyph may legitimately carry up to 32,767 points.
  let [xMin, yMin, xMax, yMax] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.xs.length; i++) {
    xMin = Math.min(xMin, points.xs[i]!);
    xMax = Math.max(xMax, points.xs[i]!);
    yMin = Math.min(yMin, points.ys[i]!);
    yMax = Math.max(yMax, points.ys[i]!);
  }
  out.i16(xMin);
  out.i16(yMin);
  out.i16(xMax);
  out.i16(yMax);
}

/** The sfnt point encoding: run-length flags, then x deltas, then y deltas. */
function writePoints(out: Writer, xs: number[], ys: number[], onCurve: boolean[]): void {
  const flags: number[] = [];
  const dxs: number[] = [];
  const dys: number[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - px;
    const dy = ys[i]! - py;
    px = xs[i]!;
    py = ys[i]!;
    let flag = onCurve[i] ? 0x01 : 0x00;
    if (dx === 0) flag |= 0x10;
    else if (dx >= -255 && dx <= 255) flag |= 0x02 | (dx > 0 ? 0x10 : 0);
    if (dy === 0) flag |= 0x20;
    else if (dy >= -255 && dy <= 255) flag |= 0x04 | (dy > 0 ? 0x20 : 0);
    flags.push(flag);
    dxs.push(dx);
    dys.push(dy);
  }
  for (const f of flags) out.u8(f);
  for (let i = 0; i < dxs.length; i++) {
    const f = flags[i]!;
    if (f & 0x02) out.u8(Math.abs(dxs[i]!));
    else if (!(f & 0x10)) out.i16(dxs[i]!);
  }
  for (let i = 0; i < dys.length; i++) {
    const f = flags[i]!;
    if (f & 0x04) out.u8(Math.abs(dys[i]!));
    else if (!(f & 0x20)) out.i16(dys[i]!);
  }
}

function writeLoca(offsets: number[], indexFormat: number): Uint8Array {
  const out = new Writer();
  for (const offset of offsets) {
    if (indexFormat === 0) out.u16(offset / 2);
    else out.u32(offset);
  }
  return out.done();
}

/** Brotli, bought and loaded only when a WOFF2 actually turns up. */
async function inflateBrotli(data: Uint8Array): Promise<Uint8Array> {
  const module = (await import("brotli/decompress.js")) as unknown as {
    default: (input: Uint8Array, size?: number) => Uint8Array;
  };
  const decompress = module.default;
  const out = decompress(data);
  if (!out) throw new WoffError("the WOFF2 body could not be decompressed");
  return out instanceof Uint8Array ? out : new Uint8Array(out);
}

/**
 * The whole container: header, directory, one Brotli stream holding every table back to back, then
 * `glyf`/`loca` put back together and the sfnt reassembled around them.
 */
export async function woff2ToSfnt(woff2: Uint8Array): Promise<Uint8Array> {
  if (!isWoff2(woff2)) throw new WoffError("these bytes are not a WOFF2 container");

  const flavor = be32(woff2, 4);
  const numTables = be16(woff2, 12);
  if (numTables === 0) throw new WoffError("the WOFF2 declares no tables");

  const directory = new Reader(woff2.subarray(HEADER));
  const entries = readDirectory(directory, numTables);
  // Its own length, not "everything left": optional metadata and private blocks follow it.
  const totalCompressed = be32(woff2, 20);
  const dataStart = HEADER + directory.offset;
  const compressed = woff2.subarray(dataStart, dataStart + totalCompressed);
  const body = await inflateBrotli(compressed);

  // The tables lie back to back in directory order, each at its TRANSFORMED length.
  const raw = new Map<string, Uint8Array>();
  let at = 0;
  for (const entry of entries) {
    if (at + entry.transformLength > body.length) {
      throw new WoffError(
        `the WOFF2 body is shorter than its table directory claims ("${entry.tag}")`,
      );
    }
    raw.set(entry.tag, body.subarray(at, at + entry.transformLength));
    at += entry.transformLength;
  }

  const tables = new Map<string, Uint8Array>();
  let locaFormat: number | undefined;
  for (const entry of entries) {
    const data = raw.get(entry.tag)!;
    if (entry.tag === "loca") continue; // rebuilt with glyf
    if (entry.tag === "glyf" && entry.transformed) {
      const rebuilt = rebuildOutlines(data);
      tables.set("glyf", rebuilt.glyf);
      tables.set("loca", rebuilt.loca);
      locaFormat = rebuilt.indexToLocFormat;
      continue;
    }
    if (entry.transformed) {
      // The only other transform the format defines is the optional one on `hmtx`, which drops the
      // left side bearings. Neither fontTools nor Google Fonts emits it, so it is named rather than
      // built - and anything else here is a file we do not understand at all.
      throw new WoffError(
        `this WOFF2 transforms "${entry.tag}", which is not supported - re-export without it`,
      );
    }
    tables.set(entry.tag, data);
  }
  if (!tables.has("loca") && entries.some((e) => e.tag === "loca")) {
    tables.set("loca", raw.get("loca")!);
  }

  // `head` tells a reader how to read `loca`, so the two must agree - and only we know which form we
  // just wrote. The table is copied first: it is a view into the decompressed buffer, not ours.
  const head = tables.get("head");
  if (locaFormat !== undefined && head) {
    if (head.length < 52) throw new WoffError("the WOFF2 head table is too short to be one");
    const patched = head.slice();
    patched[50] = 0;
    patched[51] = locaFormat;
    tables.set("head", patched);
  }

  return assemble(flavor, tables);
}

/** Writes a plain sfnt: header, table directory sorted by tag, then the padded table data. */
function assemble(flavor: number, tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const count = tags.length;
  if (count === 0) throw new WoffError("the WOFF2 produced no tables at all");
  const entrySelector = Math.floor(Math.log2(count));
  const searchRange = 2 ** entrySelector * 16;

  const out = new Writer();
  out.u16(flavor >>> 16);
  out.u16(flavor & 0xffff);
  out.u16(count);
  out.u16(searchRange);
  out.u16(entrySelector);
  out.u16(count * 16 - searchRange);

  let offset = 12 + count * 16;
  const placed: { tag: string; offset: number; length: number }[] = [];
  for (const tag of tags) {
    const data = tables.get(tag)!;
    placed.push({ tag, offset, length: data.length });
    offset += Math.ceil(data.length / 4) * 4;
  }

  for (const { tag, offset: at, length } of placed) {
    for (let i = 0; i < 4; i++) out.u8(tag.charCodeAt(i));
    out.u16(0);
    out.u16(0); // checksum: readers we care about do not verify it, and WOFF2 does not carry it
    out.u16(Math.floor(at / 0x10000));
    out.u16(at & 0xffff);
    out.u16(Math.floor(length / 0x10000));
    out.u16(length & 0xffff);
  }

  for (const tag of tags) {
    out.bytes(tables.get(tag)!);
    out.align();
  }
  return out.done();
}

import { describe, it, expect } from "vitest";
import { zlibSync } from "fflate";
import { isWoff, woffToSfnt, WoffError } from "../../../src/lib/utils/woff.ts";

// A WOFF is not a different FONT, it is a different WRAPPER: the same sfnt tables, each optionally
// zlib-compressed. So the test that matters is a round trip - wrap a known sfnt, unwrap it, and check
// the tables come back byte for byte.
//
// Both halves are built here rather than committed. The only real fonts in this repo live in the
// gitignored `claude-data/`, so a fixture-based test would fail in a fresh clone.

const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const be16 = (v: number) => [(v >>> 8) & 255, v & 255];
const tagOf = (t: string) =>
  t.charCodeAt(0) * 2 ** 24 + t.charCodeAt(1) * 65536 + t.charCodeAt(2) * 256 + t.charCodeAt(3);
const pad4 = (n: number) => (n + 3) & ~3;

interface Table {
  tag: string;
  data: Uint8Array;
}

/** Build a WOFF around the given tables, compressing a table only when that actually shrinks it. */
function makeWoff(tables: Table[], flavor = 0x00010000): Uint8Array {
  const bodies = tables.map((t) => {
    const packed = zlibSync(t.data);
    return packed.length < t.data.length ? packed : t.data;
  });
  const dirSize = tables.length * 20;
  let offset = 44 + dirSize;
  const dir: number[] = [];
  bodies.forEach((body, i) => {
    dir.push(
      ...be32(tagOf(tables[i].tag)),
      ...be32(offset),
      ...be32(body.length),
      ...be32(tables[i].data.length),
      ...be32(0), // checksum - not verified on the way back in
    );
    offset += pad4(body.length);
  });

  const out = new Uint8Array(offset);
  out.set(
    [
      ...be32(0x774f4646), // "wOFF"
      ...be32(flavor),
      ...be32(offset),
      ...be16(tables.length),
      ...be16(0),
      ...be32(0), // totalSfntSize - a hint, not used
      ...be16(1),
      ...be16(0),
      ...be32(0),
      ...be32(0),
      ...be32(0),
      ...be32(0),
      ...be32(0),
    ],
    0,
  );
  out.set(dir, 44);
  let at = 44 + dirSize;
  bodies.forEach((body) => {
    out.set(body, at);
    at += pad4(body.length);
  });
  return out;
}

/** Pull the tables back out of an sfnt, so a round trip can be compared table by table. */
function readSfnt(sfnt: Uint8Array): { flavor: number; tables: Table[] } {
  const v = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const num = v.getUint16(4);
  const tables: Table[] = [];
  for (let i = 0; i < num; i++) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(...sfnt.subarray(at, at + 4));
    const off = v.getUint32(at + 8);
    const len = v.getUint32(at + 12);
    tables.push({ tag, data: sfnt.subarray(off, off + len) });
  }
  return { flavor: v.getUint32(0), tables };
}

// Tags in ascending order, as both formats require. One table is deliberately incompressible so the
// "stored, not deflated" branch is exercised too.
const incompressible = Uint8Array.from({ length: 63 }, (_, i) => (i * 97 + 13) % 256);
const source: Table[] = [
  // 161 bytes: deliberately NOT a multiple of four, so the padding below has real work to do. With
  // only aligned lengths the padding test cannot fail, which is how the first version of it passed
  // with the padding removed.
  { tag: "cmap", data: new TextEncoder().encode("cmap".repeat(40) + "!") },
  { tag: "glyf", data: incompressible },
  { tag: "head", data: new TextEncoder().encode("head".repeat(30)) },
];

describe("recognising the container", () => {
  it("spots a WOFF and leaves anything else alone", () => {
    expect(isWoff(makeWoff(source))).toBe(true);
    expect(isWoff(new Uint8Array([0, 1, 0, 0, 0, 0]))).toBe(false); // a plain sfnt
    expect(isWoff(new Uint8Array([1, 2]))).toBe(false); // too short to ask
  });
});

describe("the round trip", () => {
  it("gives every table back byte for byte", () => {
    const { tables } = readSfnt(woffToSfnt(makeWoff(source)));
    expect(tables.map((t) => t.tag)).toEqual(["cmap", "glyf", "head"]);
    tables.forEach((t, i) => expect(Array.from(t.data)).toEqual(Array.from(source[i].data)));
  });

  it("handles a table stored uncompressed as well as a deflated one", () => {
    // `glyf` above is random bytes, so zlib makes it bigger and the writer stores it raw. Both branches
    // therefore run in the test above - this asserts the raw one really did stay raw.
    const woff = makeWoff(source);
    const view = new DataView(woff.buffer);
    const compLen = view.getUint32(44 + 20 + 8);
    const origLen = view.getUint32(44 + 20 + 12);
    expect(compLen).toBe(origLen);
  });

  it("keeps the sfnt flavour, so a TrueType stays a TrueType", () => {
    expect(readSfnt(woffToSfnt(makeWoff(source))).flavor).toBe(0x00010000);
  });

  it("writes the binary-search hints an sfnt offset table carries", () => {
    // Three tables: entrySelector = floor(log2(3)) = 1, searchRange = 2 * 16 = 32, rangeShift = 16.
    const sfnt = woffToSfnt(makeWoff(source));
    const v = new DataView(sfnt.buffer);
    expect(v.getUint16(4)).toBe(3);
    expect(v.getUint16(6)).toBe(32);
    expect(v.getUint16(8)).toBe(1);
    expect(v.getUint16(10)).toBe(16);
  });

  it("pads every table to a four-byte boundary, as an sfnt requires", () => {
    const sfnt = woffToSfnt(makeWoff(source));
    const v = new DataView(sfnt.buffer);
    const offsets = [0, 1, 2].map((i) => v.getUint32(12 + i * 16 + 8));
    const lengths = [0, 1, 2].map((i) => v.getUint32(12 + i * 16 + 12));
    for (const off of offsets) expect(off % 4).toBe(0);
    // The DECLARED length stays exact - only the gap to the next table is padded.
    expect(lengths[0]).toBe(161);
    expect(offsets[1] - offsets[0]).toBe(164);
  });
});

describe("a broken container is named, not parsed into nonsense", () => {
  it("refuses bytes that are not a WOFF at all", () => {
    expect(() => woffToSfnt(new Uint8Array(44))).toThrow(WoffError);
  });

  it("refuses a directory that does not fit in the file", () => {
    const woff = makeWoff(source);
    new DataView(woff.buffer).setUint16(12, 4000); // claim 4000 tables
    expect(() => woffToSfnt(woff)).toThrow(/table directory does not fit/);
  });

  it("refuses a table that runs past the end", () => {
    const woff = makeWoff(source);
    new DataView(woff.buffer).setUint32(44 + 4, 999_999); // first table's offset
    expect(() => woffToSfnt(woff)).toThrow(/runs past the end/);
  });

  it("refuses a table that unpacks to the wrong size", () => {
    // The declared original length is what the sfnt directory will advertise; if the data disagrees,
    // every offset after it would be wrong and the font would fail far away from the cause.
    const woff = makeWoff(source);
    new DataView(woff.buffer).setUint32(44 + 12, 99); // first table's origLength
    expect(() => woffToSfnt(woff)).toThrow(/declared 99/);
  });

  it("refuses a container with no tables", () => {
    const woff = makeWoff(source);
    new DataView(woff.buffer).setUint16(12, 0);
    expect(() => woffToSfnt(woff)).toThrow(/declares no tables/);
  });
});

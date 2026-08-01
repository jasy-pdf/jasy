import { inflateBounded } from "./inflate.ts";

/**
 * WOFF 1.0 -> plain sfnt, so the existing `TTFParser` never learns a second container format.
 *
 * A WOFF is not a different FONT, it is a different wrapper: the same sfnt tables, each optionally
 * zlib-compressed, behind a small header. Unpacking it back into an sfnt is therefore the whole job -
 * every metric, glyph and cmap path downstream stays exactly as it was.
 *
 * WOFF2 is deliberately NOT here: it compresses with Brotli, which `fflate` does not do, and it also
 * TRANSFORMS the glyf/loca tables rather than merely deflating them. That is a different piece of work,
 * not a bigger version of this one.
 */

const SIG_WOFF = 0x774f4646; // "wOFF"
const HEADER = 44;
const DIR_ENTRY = 20;

/** One table may not inflate past this. A single sfnt table above 64 MB is not a real font. */
const MAX_TABLE_BYTES = 64 * 1024 * 1024;

export class WoffError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

const be32 = (b: Uint8Array, at: number): number =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const be16 = (b: Uint8Array, at: number): number => (b[at] << 8) | b[at + 1];

/** Whether these bytes are a WOFF 1.0 container. Cheap enough to call on every font. */
export const isWoff = (bytes: Uint8Array): boolean =>
  bytes.length >= HEADER && be32(bytes, 0) === SIG_WOFF;

/**
 * Unpack a WOFF into the sfnt it wraps. The result is byte-for-byte what a `.ttf` of the same font
 * would be, apart from table padding, so nothing downstream can tell the difference.
 */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  if (!isWoff(woff)) throw new WoffError("these bytes are not a WOFF container");

  const flavor = be32(woff, 4);
  const numTables = be16(woff, 12);
  if (numTables === 0) throw new WoffError("this WOFF declares no tables");
  if (woff.length < HEADER + numTables * DIR_ENTRY) {
    throw new WoffError("this WOFF is truncated: its table directory does not fit in the file");
  }

  // Read the directory first, then the tables, so a malformed offset is caught before any allocation.
  const entries = Array.from({ length: numTables }, (_, i) => {
    const at = HEADER + i * DIR_ENTRY;
    return {
      tag: be32(woff, at),
      offset: be32(woff, at + 4),
      compLength: be32(woff, at + 8),
      origLength: be32(woff, at + 12),
      checksum: be32(woff, at + 16),
    };
  });

  const tables = entries.map((e) => {
    if (e.offset + e.compLength > woff.length) {
      throw new WoffError(`this WOFF is truncated: a table runs past the end of the file`);
    }
    const raw = woff.subarray(e.offset, e.offset + e.compLength);
    // Equal lengths mean the table was stored as-is; anything else is zlib, per the spec.
    if (e.compLength === e.origLength) return raw;
    let out: Uint8Array;
    try {
      out = inflateBounded(raw, MAX_TABLE_BYTES);
    } catch (err) {
      throw new WoffError(
        `a table in this WOFF could not be unpacked: ${String((err as Error)?.message ?? err)}`,
      );
    }
    if (out.length !== e.origLength) {
      throw new WoffError(
        `a table in this WOFF unpacked to ${out.length} bytes where it declared ${e.origLength}`,
      );
    }
    return out;
  });

  // Reassemble: offset table, directory, then the tables each padded to a 4-byte boundary.
  const padded = (n: number) => (n + 3) & ~3;
  const dirSize = numTables * 16;
  const total = 12 + dirSize + tables.reduce((n, t) => n + padded(t.length), 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  // The binary-search hints an sfnt offset table carries. Readers may ignore them; a correct file has
  // them right, and getting them wrong is the classic way a "valid" font is rejected by a strict one.
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  view.setUint32(0, flavor);
  view.setUint16(4, numTables);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, numTables * 16 - searchRange);

  let dir = 12;
  let body = 12 + dirSize;
  entries.forEach((e, i) => {
    const data = tables[i];
    view.setUint32(dir, e.tag);
    view.setUint32(dir + 4, e.checksum);
    view.setUint32(dir + 8, body);
    view.setUint32(dir + 12, data.length); // the DECLARED length excludes the padding
    out.set(data, body);
    dir += 16;
    body += padded(data.length);
  });

  return out;
}

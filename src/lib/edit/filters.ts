import { PdfStreamTooLargeError } from "../utils/inflate.ts";

// The standard stream filters besides Flate (which `utils/inflate.ts` decodes). Each one is bounded on
// what it PRODUCES: LZW and RunLength expand, so a small stream can be a bomb just like a Flate one.

/** Thrown when a stream's data is not valid for the filter it declares. */
export class PdfFilterError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

const tooLarge = (max: number) =>
  new PdfStreamTooLargeError(
    max,
    `a stream in this PDF expands past the ${max} byte limit for a single stream; if the file is ` +
      `genuinely that large, raise it with { maxStreamSize }`,
  );

/** `/ASCIIHexDecode`: hex digits, whitespace ignored, `>` ends it; an odd last digit is followed by 0. */
export function asciiHexDecode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let high = -1;
  for (const c of data) {
    if (c === 0x3e) break; // ">"
    if (c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0x00) continue;
    const v =
      c >= 0x30 && c <= 0x39
        ? c - 0x30
        : c >= 0x41 && c <= 0x46
          ? c - 55
          : c >= 0x61 && c <= 0x66
            ? c - 87
            : -1;
    if (v < 0)
      throw new PdfFilterError(`ASCIIHexDecode: "${String.fromCharCode(c)}" is not a hex digit`);
    if (high < 0) high = v;
    else {
      out.push((high << 4) | v);
      high = -1;
    }
  }
  if (high >= 0) out.push(high << 4);
  return Uint8Array.from(out);
}

/** `/ASCII85Decode`: groups of five in `!`..`u`, `z` for four zero bytes, `~>` ends it. */
export function ascii85Decode(data: Uint8Array, max: number): Uint8Array {
  const out: number[] = [];
  const group: number[] = [];
  const flush = (count: number) => {
    let n = 0;
    for (let i = 0; i < 5; i++) n = n * 85 + (group[i] ?? 84);
    if (n > 0xffffffff) throw new PdfFilterError("ASCII85Decode: a group decodes past 32 bits");
    for (let i = 0; i < count - 1; i++) out.push((n >>> (24 - 8 * i)) & 0xff);
    group.length = 0;
    if (out.length > max) throw tooLarge(max);
  };
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 0x7e) break; // "~", the start of "~>"
    if (c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0x00) continue;
    if (c === 0x7a && group.length === 0) {
      out.push(0, 0, 0, 0); // "z"
      if (out.length > max) throw tooLarge(max);
      continue;
    }
    if (c < 0x21 || c > 0x75) {
      throw new PdfFilterError(
        `ASCII85Decode: "${String.fromCharCode(c)}" is outside the alphabet`,
      );
    }
    group.push(c - 33);
    if (group.length === 5) flush(5);
  }
  if (group.length === 1) throw new PdfFilterError("ASCII85Decode: a final group of one character");
  if (group.length > 0) flush(group.length);
  return Uint8Array.from(out);
}

/** `/RunLengthDecode`: a length byte, then that many literals (0-127) or one byte repeated (129-255). */
export function runLengthDecode(data: Uint8Array, max: number): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const len = data[i++];
    if (len === 128) break;
    if (len < 128) {
      if (i + len + 1 > data.length)
        throw new PdfFilterError("RunLengthDecode: data ends inside a run");
      for (let k = 0; k <= len; k++) out.push(data[i + k]);
      i += len + 1;
    } else {
      if (i >= data.length) throw new PdfFilterError("RunLengthDecode: data ends inside a run");
      for (let k = 0; k < 257 - len; k++) out.push(data[i]);
      i += 1;
    }
    if (out.length > max) throw tooLarge(max);
  }
  return Uint8Array.from(out);
}

/**
 * `/LZWDecode`: 9 to 12 bit codes, 256 clears the table, 257 ends. `earlyChange` 1 (the default) widens
 * the code one entry early, as PDF's LZW does; 0 is the textbook variant.
 */
export function lzwDecode(data: Uint8Array, max: number, earlyChange = 1): Uint8Array {
  const out: number[] = [];
  let table: Uint8Array[] = [];
  let width = 9;
  let prev: Uint8Array | undefined;
  const reset = () => {
    table = Array.from({ length: 258 }, (_, i) => Uint8Array.of(i));
    width = 9;
    prev = undefined;
  };
  reset();
  let bitPos = 0;
  const totalBits = data.length * 8;
  while (bitPos + width <= totalBits) {
    let code = 0;
    for (let b = 0; b < width; b++) {
      const bit = (data[(bitPos + b) >> 3] >> (7 - ((bitPos + b) & 7))) & 1;
      code = (code << 1) | bit;
    }
    bitPos += width;
    if (code === 256) {
      reset();
      continue;
    }
    if (code === 257) break;
    let entry: Uint8Array;
    if (code < table.length) entry = table[code]!;
    else if (code === table.length && prev) entry = Uint8Array.from([...prev, prev[0]!]);
    else throw new PdfFilterError(`LZWDecode: code ${code} is not in the table`);
    for (const b of entry) out.push(b);
    if (out.length > max) throw tooLarge(max);
    if (prev) table.push(Uint8Array.from([...prev, entry[0]!]));
    prev = entry;
    if (table.length + earlyChange >= 1 << width && width < 12) width++;
  }
  return Uint8Array.from(out);
}

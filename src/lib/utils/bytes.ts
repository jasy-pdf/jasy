// Byte helpers for an isomorphic engine (Node + browser). Kept tiny + dependency-free; as the engine
// moves off Node-only APIs, the Node `Buffer` conveniences are replaced by these.

/**
 * A `Uint8Array` → a latin1 (ISO-8859-1) string: each byte 0x00-0xFF maps 1:1 to the same code point.
 * This matches `Buffer.toString("latin1")` exactly. NOTE: do NOT use `TextDecoder("latin1")` here - per
 * the encoding spec that label is really windows-1252, which mangles 0x80-0x9F; we need a true 1:1 pass
 * so arbitrary binary (e.g. a compressed stream) rides through unchanged. The PDF body is assembled as
 * such a binary string and the final encoder passes 0x00-0xFF through.
 */
export function latin1FromBytes(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000; // chunk the apply() to stay under the argument-count limit on big streams
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return out;
}

/**
 * A latin1 (ISO-8859-1) string → a `Uint8Array`: each char's low byte. Matches `Buffer.from(str,
 * "latin1")` / `"binary"`. Use for the binary strings the engine assembles char-by-char (CMaps, object
 * bodies) before they become a stream.
 */
export function bytesFromLatin1(str: string): Uint8Array {
  const u8a = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) u8a[i] = str.charCodeAt(i) & 0xff;
  return u8a;
}

// Big-endian integer reads from a Uint8Array (TrueType + PDF are big-endian), mirroring
// Buffer.readUInt8 / readUInt16BE / readUInt32BE / readInt16BE without needing a Buffer.
export function u8(b: Uint8Array, o: number): number {
  return b[o];
}
export function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}
export function u32(b: Uint8Array, o: number): number {
  // Multiply the top byte (a left shift by 24 would go negative in 32-bit signed math).
  return b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
}
export function i16(b: Uint8Array, o: number): number {
  const v = (b[o] << 8) | b[o + 1];
  return v & 0x8000 ? v - 0x10000 : v;
}

// Big-endian integer + latin1-string writes into a Uint8Array, mirroring Buffer.writeUInt16BE /
// writeUInt32BE / writeInt16BE / write(str, off, len, "latin1"). Arg order matches Buffer: (value, offset).
export function wu16(b: Uint8Array, value: number, offset: number): void {
  b[offset] = (value >>> 8) & 0xff;
  b[offset + 1] = value & 0xff;
}
export function wu32(b: Uint8Array, value: number, offset: number): void {
  b[offset] = (value >>> 24) & 0xff;
  b[offset + 1] = (value >>> 16) & 0xff;
  b[offset + 2] = (value >>> 8) & 0xff;
  b[offset + 3] = value & 0xff;
}
export function wi16(b: Uint8Array, value: number, offset: number): void {
  wu16(b, value & 0xffff, offset);
}
export function writeLatin1(b: Uint8Array, str: string, offset: number): void {
  for (let i = 0; i < str.length; i++) b[offset + i] = str.charCodeAt(i) & 0xff;
}

/** Concatenate Uint8Arrays into one (mirrors Buffer.concat). */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

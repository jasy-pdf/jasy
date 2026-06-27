// MD5 (RFC 1321), vendored + isomorphic - so the font subset tag and the documentId /ID hash work in the
// browser too: Node `crypto` is absent there, and Web Crypto has no MD5 and is async. Verified byte-for-byte
// identical to Node's `createHash("md5")`. Operates on bytes; callers UTF-8-encode strings (TextEncoder),
// matching `hash.update(string)`'s default encoding.

// Per-round left-rotate amounts.
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
  10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

// Per-round constants K[i] = floor(abs(sin(i+1)) * 2^32).
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0;

/** The raw 16-byte MD5 digest of `input`. */
export function md5(input: Uint8Array): Uint8Array {
  const len = input.length;
  // Pad to a multiple of 64: message + 0x80 + zeros + 64-bit little-endian bit length.
  const total = (((len + 8) >> 6) + 1) << 6;
  const b = new Uint8Array(total);
  b.set(input);
  b[len] = 0x80;
  const bits = len * 8;
  b[total - 8] = bits & 0xff;
  b[total - 7] = (bits >>> 8) & 0xff;
  b[total - 6] = (bits >>> 16) & 0xff;
  b[total - 5] = (bits >>> 24) & 0xff;
  // High 32 bits of the length stay 0 (inputs are well under 512 MB).

  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      M[i] = b[j] | (b[j + 1] << 8) | (b[j + 2] << 16) | (b[j + 3] << 24);
    }
    let A = a0,
      B = b0,
      C = c0,
      D = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) {
        f = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        f = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        f = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      f = (f + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((f << S[i]) | (f >>> (32 - S[i])) | 0)) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  const out = new Uint8Array(16);
  const w = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i++) {
    out[i * 4] = w[i] & 0xff;
    out[i * 4 + 1] = (w[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (w[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (w[i] >>> 24) & 0xff;
  }
  return out;
}

/** Lowercase hex of the MD5 digest (matches `digest("hex")`). */
export function md5Hex(input: Uint8Array): string {
  return [...md5(input)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

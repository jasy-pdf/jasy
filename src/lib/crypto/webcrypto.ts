// Isomorphic crypto via the platform WebCrypto (`globalThis.crypto.subtle`) - native in the browser AND in
// Node 20+, with zero dependencies. This is the primitive layer the PDF Standard security handler (AES-256,
// R6) builds on. Everything is async (so is `render()`), so that is no constraint.
//
// One wrinkle: WebCrypto's AES-CBC ALWAYS applies PKCS#7 padding and offers no raw/no-pad mode. The PDF R6
// key derivation (Algorithm 2.B, /UE, /OE, /Perms) needs UNPADDED AES, so we synthesize it from the padded
// primitive (encrypt: drop the trailing pad block; decrypt: append a block that decrypts to a full pad, then
// let WebCrypto strip it). Document strings/streams use the padded primitive directly - that IS AESV3.

const subtle = (): SubtleCrypto => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error(
      "@jasy/pdf: PDF encryption needs WebCrypto (globalThis.crypto.subtle), unavailable here.",
    );
  }
  return c.subtle;
};

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  (globalThis as { crypto: Crypto }).crypto.getRandomValues(b);
  return b;
}

// WebCrypto's types want a BufferSource backed by ArrayBuffer; our Uint8Arrays are ArrayBuffer-backed, so
// this cast at the platform boundary is safe (TS 5.7+ just can't prove it isn't a SharedArrayBuffer).
const buf = (a: Uint8Array): BufferSource => a as unknown as BufferSource;

export async function sha(bits: 256 | 384 | 512, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest(`SHA-${bits}`, buf(data)));
}

async function aesKey(key: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return subtle().importKey("raw", buf(key), { name: "AES-CBC" }, false, [usage]);
}

/** AES-CBC with PKCS#7 padding (the AESV3 mode for PDF strings/streams). */
export async function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle().encrypt(
      { name: "AES-CBC", iv: buf(iv) },
      await aesKey(key, "encrypt"),
      buf(data),
    ),
  );
}
export async function aesCbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await subtle().decrypt(
      { name: "AES-CBC", iv: buf(iv) },
      await aesKey(key, "decrypt"),
      buf(data),
    ),
  );
}

/** AES-CBC WITHOUT padding (`data.length` must be a multiple of 16). WebCrypto pads unconditionally, so we
 *  encrypt and drop the extra full pad block - the leading blocks are the true unpadded CBC. */
export async function aesCbcEncryptNoPad(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  return (await aesCbcEncrypt(key, iv, data)).subarray(0, data.length);
}

const xor16 = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const o = new Uint8Array(16);
  for (let i = 0; i < 16; i++) o[i] = a[i] ^ b[i];
  return o;
};

/** AES-CBC no-padding DECRYPT (`data` a multiple of 16). We append one cipher block crafted to decrypt to a
 *  full 0x10 PKCS#7 pad (so WebCrypto accepts and strips it), leaving the original. */
export async function aesCbcDecryptNoPad(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const prev = data.length >= 16 ? data.subarray(data.length - 16) : iv;
  // ECB(x) == first block of CBC(iv=0, x); we want the appended block to decrypt to 0x10*16 after the CBC xor.
  const appended = await aesCbcEncryptNoPad(
    key,
    new Uint8Array(16),
    xor16(new Uint8Array(16).fill(16), prev),
  );
  const withPad = new Uint8Array(data.length + 16);
  withPad.set(data);
  withPad.set(appended, data.length);
  return aesCbcDecrypt(key, iv, withPad);
}

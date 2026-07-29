import { aesCbcDecrypt } from "./webcrypto.ts";
import { md5 } from "../utils/md5.ts";
import type { SecurityHandler } from "./security-handler.ts";

/**
 * The OLDER standard security handlers, for READING only: R2 and R3 (RC4, 40 and 128 bit) and R4
 * (RC4 or AES-128).
 *
 * Read-only is a deliberate asymmetry, not an omission. RC4 is broken - biased keystream, and R2 uses a
 * 40-bit key that is brute-forced in minutes - and PDF 2.0 removed it outright. But it is what PDFKit,
 * react-pdf and Ghostscript still produce BY DEFAULT when you ask them for a password, so refusing to
 * open such a file means refusing most of the encrypted PDFs anyone actually has. Writing one would be
 * a different matter: offering a user "protection" we know to be broken helps nobody, so `encrypt`
 * here throws.
 *
 * Two things distinguish these revisions from the modern R6:
 * - the file key comes from MD5 over the password, `/O`, `/P` and the first `/ID` string (algorithm 2);
 * - every object gets its OWN key, derived from the file key plus its number and generation
 *   (algorithm 1). That is why `SecurityHandler.encrypt/decrypt` take a `ref`.
 */

/** The padding every legacy revision prepends to a password (algorithm 2, step a). */
const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

/** A password padded (or truncated) to the 32 bytes the algorithm wants. */
function padPassword(password: string): Uint8Array {
  const pw = new Uint8Array(32);
  // Latin-1: the legacy handlers predate unicode passwords entirely.
  const raw = Uint8Array.from(password, (c) => c.charCodeAt(0) & 0xff);
  const take = Math.min(raw.length, 32);
  pw.set(raw.subarray(0, take), 0);
  pw.set(PAD.subarray(0, 32 - take), take);
  return pw;
}

/** RC4. Not available in WebCrypto - for good reasons - so it is written out here, for reading only. */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** What the `/Encrypt` dictionary tells us, already parsed by the reader. */
export interface LegacyEncryptInfo {
  revision: number;
  /** `/Length` in BITS (default 40). */
  keyBits: number;
  o: Uint8Array;
  u: Uint8Array;
  /** `/P`, the permission flags, as the signed 32-bit value the algorithm feeds in. */
  permissions: number;
  /** The first string of the document `/ID`. */
  id: Uint8Array;
  encryptMetadata: boolean;
  /** True when the crypt filter is AESV2 rather than RC4. */
  aes: boolean;
}

export class StandardLegacy implements SecurityHandler {
  private constructor(
    private readonly fileKey: Uint8Array,
    private readonly aes: boolean,
  ) {}

  encryptDict(): string {
    throw new Error(
      "@jasy/pdf: this handler only READS legacy encryption; jasy writes AES-256 (R6) exclusively",
    );
  }

  async encrypt(): Promise<Uint8Array> {
    throw new Error(
      "@jasy/pdf: refusing to write RC4 or AES-128 - they are obsolete; jasy writes AES-256 (R6)",
    );
  }

  async decrypt(data: Uint8Array, ref?: { num: number; gen: number }): Promise<Uint8Array> {
    const key = this.objectKey(ref);
    if (!this.aes) return rc4(key, data);
    if (data.length <= 16) return new Uint8Array(0); // an IV and nothing else
    return aesCbcDecrypt(key, data.subarray(0, 16), data.subarray(16));
  }

  /**
   * Algorithm 1: every object is enciphered with its own key, derived from the file key plus the
   * object's number and generation. Miss this and every single object decrypts to noise.
   */
  private objectKey(ref?: { num: number; gen: number }): Uint8Array {
    const num = ref?.num ?? 0;
    const gen = ref?.gen ?? 0;
    const extra = new Uint8Array(this.aes ? 9 : 5);
    extra[0] = num & 0xff;
    extra[1] = (num >> 8) & 0xff;
    extra[2] = (num >> 16) & 0xff;
    extra[3] = gen & 0xff;
    extra[4] = (gen >> 8) & 0xff;
    // AES adds the literal "sAlT" - the spec really does spell it that way.
    if (this.aes) extra.set([0x73, 0x41, 0x6c, 0x54], 5);
    const digest = md5(concat(this.fileKey, extra));
    return digest.subarray(0, Math.min(this.fileKey.length + 5, 16));
  }

  /**
   * Open a legacy-encrypted document: derive the file key from the password (algorithm 2), then CHECK it
   * against `/U` (algorithm 6) so a wrong password is rejected rather than silently producing noise.
   */
  static open(password: string, info: LegacyEncryptInfo): SecurityHandler {
    const keyLength = info.revision === 2 ? 5 : Math.max(5, Math.floor(info.keyBits / 8));
    const p = new Uint8Array(4);
    new DataView(p.buffer).setInt32(0, info.permissions, true); // little-endian, signed

    let input = concat(padPassword(password), info.o.subarray(0, 32), p, info.id);
    // R4 with /EncryptMetadata false folds in four 0xFF bytes.
    if (info.revision >= 4 && !info.encryptMetadata) {
      input = concat(input, new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    }
    let key = md5(input);
    if (info.revision >= 3) {
      // 50 further rounds over the first keyLength bytes only.
      for (let i = 0; i < 50; i++) key = md5(key.subarray(0, keyLength));
    }
    key = key.subarray(0, keyLength);

    if (!StandardLegacy.passwordMatches(key, info)) {
      throw new Error("@jasy/pdf: wrong password.");
    }
    return new StandardLegacy(key, info.aes);
  }

  /** Algorithm 6: rebuild what `/U` must look like for this key and compare. */
  private static passwordMatches(key: Uint8Array, info: LegacyEncryptInfo): boolean {
    if (info.revision === 2) {
      const expect = rc4(key, PAD);
      return expect.every((b, i) => b === info.u[i]);
    }
    // R3+ : MD5 over the padding and the /ID, then 20 rounds of RC4 with the key XORed by the round.
    let x = md5(concat(PAD, info.id));
    x = rc4(key, x);
    for (let round = 1; round <= 19; round++) {
      const rk = Uint8Array.from(key, (b) => b ^ round);
      x = rc4(rk, x);
    }
    // Only the first 16 bytes are meaningful; the rest of /U is arbitrary padding.
    for (let i = 0; i < 16; i++) if (x[i] !== info.u[i]) return false;
    return true;
  }
}

export { rc4 };

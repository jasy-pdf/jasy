// PDF Standard security handler. The PDFObjectManager talks to the `SecurityHandler` interface, never to a
// concrete algorithm - so adding another scheme later (a new revision, or per-object RC4/AES-128) is just a
// second implementation + a factory branch, with the writer untouched. Today we ship exactly one:
// `StandardAes256` = AES-256, V5/R6 (ISO 32000-2 / PDF 2.0), the newest standard PDF encryption.
import {
  aesCbcDecrypt,
  aesCbcDecryptNoPad,
  aesCbcEncrypt,
  aesCbcEncryptNoPad,
  randomBytes,
  sha,
} from "./webcrypto.ts";

/** A handler encrypts/decrypts the strings + streams of a document and describes itself as an `/Encrypt` dict. */
export interface SecurityHandler {
  /** The `/Encrypt` dictionary body (between `<<` and `>>`). Its own strings are never encrypted. */
  encryptDict(): string;
  /** Encrypt one string/stream. `ref` is unused for V5/R6 (one file key) but kept for future per-object schemes. */
  encrypt(data: Uint8Array, ref?: { num: number; gen: number }): Promise<Uint8Array>;
  /** Decrypt one string/stream (the groundwork the future "open/edit existing PDF" path reuses). */
  decrypt(data: Uint8Array, ref?: { num: number; gen: number }): Promise<Uint8Array>;
}

/** What the user grants; everything defaults to allowed. Maps to the `/P` bitfield (ISO 32000-2 Table 22). */
export interface Permissions {
  printing?: boolean;
  copying?: boolean;
  modifying?: boolean;
  annotating?: boolean;
}

export interface EncryptOptions {
  /** Only "aes-256" today - the seam for future algorithms. */
  algorithm?: "aes-256";
  userPassword: string;
  /** Full-rights password; defaults to the user password if omitted. */
  ownerPassword?: string;
  permissions?: Permissions;
}

const utf8 = (s: string) => new TextEncoder().encode(s).subarray(0, 127); // R6 truncates passwords to 127 bytes
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const toHex = (a: Uint8Array) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
// Constant-time-ish equality for password validation (no early-out on the first differing byte).
const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};

// ISO 32000-2 Algorithm 2.B: the hardened password hash. Loops AES-128-CBC + SHA-256/384/512 until the
// stopping rule. `udata` is the 48-byte /U for the owner computations, empty for the user ones.
async function hash2B(
  password: Uint8Array,
  salt: Uint8Array,
  udata: Uint8Array,
): Promise<Uint8Array> {
  let k = await sha(256, concat(password, salt, udata));
  let e: Uint8Array = new Uint8Array(0);
  // At least 64 rounds; then stop once the last byte of E <= round - 32 (ISO 32000-2 Algorithm 2.B).
  for (let round = 0; round < 64 || e[e.length - 1] > round - 32; round++) {
    const block = concat(password, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    e = await aesCbcEncryptNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i]; // big-endian 128-bit mod 3 == byte-sum mod 3 (256 ≡ 1 mod 3)
    k = await sha(([256, 384, 512] as const)[sum % 3], e);
  }
  return k.subarray(0, 32);
}

function permissionBits(p: Permissions = {}): number {
  const { printing = true, copying = true, modifying = true, annotating = true } = p;
  let bits = 0xfffff000 | 0b11000000; // reserved-1 bits (positions 7-8 and 13-32)
  if (printing) bits |= 4 | 2048;
  if (modifying) bits |= 8 | 1024;
  if (copying) bits |= 16 | 512;
  if (annotating) bits |= 32 | 256;
  return bits | 0; // int32
}

class StandardAes256 implements SecurityHandler {
  private constructor(
    private readonly fileKey: Uint8Array,
    private readonly dict: string,
  ) {}

  static async create(opts: EncryptOptions): Promise<StandardAes256> {
    const user = utf8(opts.userPassword);
    const owner = utf8(opts.ownerPassword ?? opts.userPassword);
    const fileKey = randomBytes(32);
    const p = permissionBits(opts.permissions);

    // Algorithm 8: /U and /UE.
    const uVS = randomBytes(8);
    const uKS = randomBytes(8);
    const empty = new Uint8Array(0);
    const u = concat(await hash2B(user, uVS, empty), uVS, uKS); // 48 bytes
    const ue = await aesCbcEncryptNoPad(
      await hash2B(user, uKS, empty),
      new Uint8Array(16),
      fileKey,
    );

    // Algorithm 9: /O and /OE (these also fold in /U).
    const oVS = randomBytes(8);
    const oKS = randomBytes(8);
    const o = concat(await hash2B(owner, oVS, u), oVS, oKS); // 48 bytes
    const oe = await aesCbcEncryptNoPad(await hash2B(owner, oKS, u), new Uint8Array(16), fileKey);

    // Algorithm 10: /Perms (a 16-byte block, ECB == single-block CBC with a zero IV).
    const perms = new Uint8Array(16);
    perms[0] = p & 0xff;
    perms[1] = (p >> 8) & 0xff;
    perms[2] = (p >> 16) & 0xff;
    perms[3] = (p >> 24) & 0xff;
    perms[4] = perms[5] = perms[6] = perms[7] = 0xff;
    perms[8] = 0x46; // 'F' - metadata (XMP) stays unencrypted (standard; keeps it indexer-readable)
    perms[9] = 0x61; // 'a'
    perms[10] = 0x64; // 'd'
    perms[11] = 0x62; // 'b'
    perms.set(randomBytes(4), 12);
    const permsEnc = await aesCbcEncryptNoPad(fileKey, new Uint8Array(16), perms);

    const dict =
      `/Filter /Standard /V 5 /R 6 /Length 256 /P ${p} /EncryptMetadata false ` +
      `/CF << /StdCF << /CFM /AESV3 /AuthEvent /DocOpen /Length 32 >> >> /StmF /StdCF /StrF /StdCF ` +
      `/U <${toHex(u)}> /UE <${toHex(ue)}> /O <${toHex(o)}> /OE <${toHex(oe)}> /Perms <${toHex(permsEnc)}>`;
    return new StandardAes256(fileKey, dict);
  }

  encryptDict(): string {
    return this.dict;
  }

  async encrypt(data: Uint8Array): Promise<Uint8Array> {
    const iv = randomBytes(16);
    const ct = await aesCbcEncrypt(this.fileKey, iv, data);
    return concat(iv, ct);
  }

  async decrypt(data: Uint8Array): Promise<Uint8Array> {
    return aesCbcDecrypt(this.fileKey, data.subarray(0, 16), data.subarray(16));
  }

  /** Recover the file key from a password as a reader does: validate it against /U FIRST (so a wrong
   *  password is rejected, not silently turned into a garbage key), then decrypt /UE. The groundwork the
   *  future "open/edit existing PDF" path reuses. Throws on a wrong password. */
  static async recoverFileKey(
    userPassword: string,
    u: Uint8Array,
    ue: Uint8Array,
  ): Promise<Uint8Array> {
    const pw = utf8(userPassword);
    // Algorithm 11: hash(password + validation salt) must equal the first 32 bytes of /U.
    const check = await hash2B(pw, u.subarray(32, 40), new Uint8Array(0));
    if (!bytesEqual(check, u.subarray(0, 32))) {
      throw new Error("@jasy/pdf: wrong password.");
    }
    const intermediate = await hash2B(pw, u.subarray(40, 48), new Uint8Array(0));
    return aesCbcDecryptNoPad(intermediate, new Uint8Array(16), ue);
  }
}

/** The factory = the seam. Today it always returns the AES-256 handler. */
export async function createSecurityHandler(opts: EncryptOptions): Promise<SecurityHandler> {
  if (opts.algorithm && opts.algorithm !== "aes-256") {
    throw new Error(
      `@jasy/pdf: unsupported encryption algorithm "${opts.algorithm}" (only "aes-256").`,
    );
  }
  return StandardAes256.create(opts);
}

export { StandardAes256 };

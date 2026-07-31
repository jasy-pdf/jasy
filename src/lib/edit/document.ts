import { Lexer } from "./lexer.ts";
import { DEFAULT_MAX_STREAM_SIZE, inflateBounded, PdfStreamTooLargeError } from "./inflate.ts";
import {
  get,
  isDict,
  isRef,
  isStream,
  isString,
  nameOf,
  numberOf,
  stringsIn,
  type PdfDict,
  type PdfObject,
  type PdfStream,
} from "./objects.ts";
import { StandardAes256, type SecurityHandler } from "../crypto/security-handler.ts";
import { StandardLegacy } from "../crypto/legacy-handler.ts";

/**
 * A loaded PDF: the cross-reference index plus object lookup.
 *
 * A PDF is not read front to back - it is a small object database whose index sits at the END. Loading
 * therefore means: find `startxref`, read the index it points at, follow the `/Prev` chain back through
 * any incremental updates, and only then look objects up by number.
 *
 * Two index formats exist and both occur in the wild: the classic `xref` table (PDFKit, our own writer)
 * and a compressed **xref stream** (pdf-lib by default, and every modern real-world file). The same is
 * true one level down: an object may sit plainly in the file, or packed inside an **object stream**
 * together with dozens of others.
 */

/** Where object `n` lives: at a byte offset, or inside an object stream. */
type XrefEntry =
  | { kind: "offset"; offset: number; gen: number }
  | { kind: "inStream"; stream: number; index: number };

const EMPTY = new Uint8Array(0);

/** What `PdfDocument.load` accepts. */
export interface LoadOptions {
  /** Ceiling on what ONE stream may inflate to, in bytes (default 64 MB). Raise it for a document that
   *  is genuinely enormous; a stream past it throws `PdfStreamTooLargeError` rather than being read. */
  maxStreamSize?: number;
}

/** What `PdfDocument.open` accepts - everything `load` takes, plus the password. */
export interface OpenOptions extends LoadOptions {
  password?: string;
}

/** Thrown when a file cannot be opened because of its encryption - always saying which of the reasons it
 *  is: no password, wrong password, or a revision we do not implement. */
export class PdfEncryptedError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

/** The raw bytes of a `/Encrypt` entry that must be a string (`/U`, `/UE`). */
const stringBytes = (o: PdfObject | undefined): Uint8Array | undefined =>
  isString(o) ? o.bytes : undefined;

export class PdfDocument {
  private readonly xref = new Map<number, XrefEntry>();
  private readonly cache = new Map<number, PdfObject | undefined>();
  /** Object streams already unpacked, by their object number. */
  private readonly objStmCache = new Map<number, Map<number, PdfObject>>();
  /** Set once an encrypted file has been opened with its password. */
  private security?: SecurityHandler;
  /** Decrypted stream payloads, keyed by the stream's data offset (unique per stream). */
  private readonly plainStreams = new Map<number, Uint8Array>();
  /** True when the cross-reference index was unusable and had to be rebuilt by scanning. Surfaced so
   *  a caller can report it - a silently repaired file is exactly the kind of guess we avoid. */
  recovered = false;
  trailer: PdfDict = { kind: "dict", map: new Map() };
  /** Whether this file indexes itself with an xref STREAM rather than a classic table. An incremental
   *  update has to follow suit: mixing the two leaves readers that understand only one kind unable to
   *  walk the chain back. */
  usesXrefStream = false;

  /** Ceiling on what one stream may inflate to; see `inflate.ts`. */
  private maxStreamSize = DEFAULT_MAX_STREAM_SIZE;

  private constructor(readonly bytes: Uint8Array) {}

  static load(bytes: Uint8Array, opts: LoadOptions = {}): PdfDocument {
    const doc = new PdfDocument(bytes);
    if (opts.maxStreamSize !== undefined) doc.maxStreamSize = opts.maxStreamSize;
    try {
      doc.readXrefChain();
    } catch {
      doc.xref.clear();
    }
    // No index, or one that does not lead to a catalog: rebuild it by scanning for object headers.
    // Damaged tables are common enough in the wild that refusing here would reject usable files.
    if (doc.xref.size === 0 || doc.catalog === undefined) doc.rebuildByScanning();
    return doc;
  }

  /**
   * Open a document, decrypting it when it is password-protected.
   *
   * Async because key derivation and AES are (WebCrypto), and because decryption happens ONCE here,
   * eagerly, rather than at every read: that keeps `getObject`, `streamData` and the whole form layer
   * above them synchronous, which is the same trade the writer makes (`structure.ts` builds the handler
   * before the synchronous constructor).
   */
  static async open(bytes: Uint8Array, opts: OpenOptions = {}): Promise<PdfDocument> {
    const doc = PdfDocument.load(bytes, opts);
    if (!doc.isEncrypted) return doc;
    doc.security = await doc.securityHandlerFor(opts.password);
    await doc.decryptEverything();
    return doc;
  }

  /**
   * Build the handler for this file's `/Encrypt` dictionary, or say precisely why we cannot.
   *
   * Every refusal names its reason: no password given, wrong password, or an encryption revision we do
   * not implement. "Cannot open this file" would be the unhelpful answer, and guessing would be worse.
   */
  private async securityHandlerFor(password: string | undefined): Promise<SecurityHandler> {
    const enc = this.resolve(this.trailer.map.get("Encrypt"));
    const filter = nameOf(this.lookup(enc, "Filter"));
    const v = numberOf(this.lookup(enc, "V")) ?? 0;
    const r = numberOf(this.lookup(enc, "R")) ?? 0;
    if (filter !== "Standard") {
      throw new PdfEncryptedError(
        `this PDF uses the ${filter ?? "unknown"} security handler; jasy implements only the standard one`,
      );
    }

    // An EMPTY user password is legal and common: a document restricted only by an owner password opens
    // everywhere without prompting. So always try "" first and only complain about a MISSING password
    // once that has failed - refusing up front would reject files nothing else refuses.
    const pw = password ?? "";
    const rejected = (): never => {
      throw password === undefined
        ? new PdfEncryptedError("this PDF is encrypted; pass its password to open it")
        : new PdfEncryptedError("wrong password for this PDF");
    };
    // `recoverFileKey` / `StandardLegacy.open` say "wrong password" by name; anything else that comes out
    // of them is structural (a malformed /U, /UE, /O) and must not be reported as a bad password.
    const isWrongPassword = (e: unknown) =>
      String((e as Error)?.message ?? e).includes("wrong password");
    const incomplete = (what: string): never => {
      throw new PdfEncryptedError(`this PDF's /Encrypt dictionary is ${what}; it cannot be opened`);
    };

    // R5 and R6 are AES-256 with one file key; R2 to R4 derive a key per object and may use RC4.
    if (v === 5 && (r === 5 || r === 6)) {
      const u = stringBytes(this.lookup(enc, "U"));
      const ue = stringBytes(this.lookup(enc, "UE"));
      if (u === undefined || ue === undefined || u.length < 48) incomplete("incomplete");
      // /UE is unwrapped with AES-CBC and no padding, so a length that is not a whole number of blocks
      // is a broken file, not a wrong password.
      if (ue!.length === 0 || ue!.length % 16 !== 0)
        incomplete("/UE is not a whole number of AES blocks");
      try {
        return await StandardAes256.forReading(pw, u!, ue!, r);
      } catch (e) {
        if (isWrongPassword(e)) rejected();
        throw new PdfEncryptedError(
          `this PDF's encryption could not be unwrapped: ${String((e as Error)?.message ?? e)}`,
        );
      }
    }

    if (r >= 2 && r <= 4) {
      const o = stringBytes(this.lookup(enc, "O"));
      const u = stringBytes(this.lookup(enc, "U"));
      if (o === undefined || u === undefined) incomplete("incomplete");
      const cipher = this.streamCipher(enc, v);
      if (cipher.kind === "identity") {
        throw new PdfEncryptedError(
          "this PDF declares encryption but selects the Identity crypt filter, which jasy does not model",
        );
      }
      const ids = this.trailer.map.get("ID");
      const firstId = Array.isArray(ids) ? stringBytes(this.resolve(ids[0])) : undefined;
      try {
        return StandardLegacy.open(pw, {
          revision: r,
          keyBits: cipher.keyBits,
          o: o!,
          u: u!,
          permissions: numberOf(this.lookup(enc, "P")) ?? 0,
          id: firstId ?? EMPTY,
          encryptMetadata: this.lookup(enc, "EncryptMetadata") !== false,
          aes: cipher.kind === "aes",
        });
      } catch (e) {
        if (isWrongPassword(e)) rejected();
        throw new PdfEncryptedError(
          `this PDF's encryption could not be set up: ${String((e as Error)?.message ?? e)}`,
        );
      }
    }

    throw new PdfEncryptedError(
      `this PDF uses standard security V${v}/R${r}, which jasy does not implement`,
    );
  }

  /**
   * Which cipher and key length actually apply to the streams.
   *
   * For V4 the answer is NOT the top-level `/Length`: the document names a crypt filter in `/StmF` and
   * that filter carries its own `/CFM` and `/Length` (in BYTES, where the top-level one is in bits).
   * `/Identity` means the streams are not enciphered at all - decrypting them anyway would destroy them.
   */
  private streamCipher(
    enc: PdfObject | undefined,
    v: number,
  ): { kind: "rc4" | "aes" | "identity"; keyBits: number } {
    const topBits = numberOf(this.lookup(enc, "Length")) ?? 40;
    if (v < 4) return { kind: "rc4", keyBits: topBits };

    const stmf = nameOf(this.lookup(enc, "StmF")) ?? "Identity";
    if (stmf === "Identity") return { kind: "identity", keyBits: topBits };
    const cf = this.lookup(this.lookup(enc, "CF"), stmf);
    const cfm = nameOf(this.lookup(cf, "CFM"));
    if (cfm === "None" || cfm === undefined) return { kind: "identity", keyBits: topBits };
    const cfBytes = numberOf(this.lookup(cf, "Length"));
    return {
      kind: cfm === "AESV2" ? "aes" : "rc4",
      keyBits: cfBytes !== undefined ? cfBytes * 8 : topBits,
    };
  }

  /**
   * Decrypt every string and stream, once, in place.
   *
   * Three things are deliberately NOT decrypted, because they were never encrypted (ISO 32000-1 7.6.2):
   * the `/Encrypt` dictionary's own strings, a cross-reference stream, and strings of objects that live
   * inside an object stream - the object stream was enciphered as a whole, so its members come out in
   * the clear already.
   */
  private async decryptEverything(): Promise<void> {
    const security = this.security;
    if (!security) return;
    const encryptNum = isRef(this.trailer.map.get("Encrypt"))
      ? (this.trailer.map.get("Encrypt") as { num: number }).num
      : undefined;

    // `/EncryptMetadata false` means the XMP metadata stream was left in the CLEAR on purpose - the
    // industry norm, so indexers can read a file they cannot open. Deciphering it anyway destroys it,
    // and it is what made an accessible+encrypted document unopenable.
    const metadataInClear =
      this.lookup(this.resolve(this.trailer.map.get("Encrypt")), "EncryptMetadata") === false;

    // Streams first: an object stream has to be readable before its members can be served at all.
    for (const [num, entry] of this.xref) {
      if (entry.kind !== "offset" || num === encryptNum) continue;
      const obj = this.getObject(num);
      if (obj === undefined || !isStream(obj)) continue;
      const type = nameOf(get(obj, "Type"));
      if (type === "XRef") continue; // never encrypted - it holds the index itself
      if (type === "Metadata" && metadataInClear) continue;
      // Keyed by the stream's DATA OFFSET, not its object number: `streamData` receives the stream
      // object and has no number in hand.
      this.plainStreams.set(
        obj.start,
        await security.decrypt(this.rawStream(obj), { num, gen: entry.gen }),
      );
    }

    // Everything parsed so far came out of ENCIPHERED bytes: `load` already resolved the catalog to check
    // it, and if that catalog lives in an object stream its members were inflated from ciphertext and
    // cached as garbage. Drop both caches now that `plainStreams` can serve the real data. The xref index
    // itself stays - it was never encrypted.
    this.cache.clear();
    this.objStmCache.clear();

    // Then the strings, in objects that sit directly in the file.
    for (const [num, entry] of this.xref) {
      if (entry.kind !== "offset" || num === encryptNum) continue;
      const obj = this.getObject(num);
      if (obj === undefined) continue;
      for (const s of stringsIn(obj)) {
        try {
          s.bytes = await security.decrypt(s.bytes, { num, gen: entry.gen });
        } catch {
          // The password already validated against /U, so the key is right and this string simply is
          // not ciphertext - a producer left it in the clear. Say so instead of surfacing an AES error.
          throw new PdfEncryptedError(
            `object ${num} contains a string that is not encrypted, so this file does not follow its own ` +
              "/Encrypt declaration and cannot be read safely",
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Cross-reference index
  // -------------------------------------------------------------------------------------------

  /** The byte offset in the `startxref` trailer at the very end of the file. */
  private findStartXref(): number | undefined {
    const tail = new TextDecoder("latin1").decode(
      this.bytes.subarray(Math.max(0, this.bytes.length - 2048)),
    );
    const at = tail.lastIndexOf("startxref");
    if (at < 0) return undefined;
    const n = /startxref\s+(\d+)/.exec(tail.slice(at));
    return n ? Number(n[1]) : undefined;
  }

  /** Read the index at `startxref`, then walk `/Prev` back through earlier revisions. Entries already
   *  known win: the NEWEST revision is read first, and an older one must not overwrite it. */
  private readXrefChain(): void {
    let offset = this.findStartXref();
    const seen = new Set<number>();
    while (offset !== undefined && offset >= 0 && offset < this.bytes.length && !seen.has(offset)) {
      seen.add(offset);
      const dict = this.readXrefSection(offset);
      if (!dict) break;
      if (this.trailer.map.size === 0) this.trailer = dict;
      // A hybrid-reference file keeps a second, stream-based index for the same revision.
      const hybrid = numberOf(dict.map.get("XRefStm"));
      if (hybrid !== undefined && !seen.has(hybrid)) {
        seen.add(hybrid);
        this.readXrefSection(hybrid);
      }
      offset = numberOf(dict.map.get("Prev"));
    }
  }

  /** One index section, either format. Returns its trailer dictionary. */
  private readXrefSection(offset: number): PdfDict | undefined {
    const lx = new Lexer(this.bytes, offset);
    if (lx.eatWord("xref")) return this.readXrefTable(lx);

    // Otherwise it must be an `N G obj` header introducing an xref STREAM.
    lx.pos = offset;
    lx.parse(); // object number
    lx.parse(); // generation
    if (!lx.eatWord("obj")) return undefined;
    const obj = lx.parse();
    if (obj === undefined || !isStream(obj)) return undefined;
    if (nameOf(get(obj, "Type")) !== "XRef") return undefined;
    this.usesXrefStream = true;
    this.readXrefStream(obj);
    return obj.dict;
  }

  /** The classic table: `xref`, then `start count` subsections of 20-byte entries, then `trailer`. */
  private readXrefTable(lx: Lexer): PdfDict | undefined {
    for (;;) {
      if (lx.eatWord("trailer")) {
        const t = lx.parse();
        return t !== undefined && isDict(t) ? t : undefined;
      }
      const start = lx.parse();
      const count = lx.parse();
      if (typeof start !== "number" || typeof count !== "number") return undefined;
      for (let i = 0; i < count; i++) {
        const offset = lx.parse();
        const gen = lx.parse();
        lx.skip();
        const type = String.fromCharCode(this.bytes[lx.pos]);
        lx.pos++;
        if (typeof offset !== "number" || typeof gen !== "number") return undefined;
        // 'n' = in use, 'f' = free. A free slot is not an object.
        if (type === "n") this.note(start + i, { kind: "offset", offset, gen });
      }
    }
  }

  /**
   * An xref STREAM: fixed-width binary rows, widths in `/W`, object numbers from `/Index`. Row type 1
   * is a plain byte offset, type 2 points into an object stream, type 0 is a free slot.
   */
  private readXrefStream(stream: PdfStream): void {
    const data = this.streamData(stream);
    const w = (get(stream, "W") as PdfObject[] | undefined)?.map((x) => numberOf(x) ?? 0) ?? [];
    if (w.length < 3) return;
    const rowLen = w[0] + w[1] + w[2];
    if (rowLen === 0) return;

    const size = numberOf(get(stream, "Size")) ?? 0;
    const indexRaw = get(stream, "Index");
    const index = Array.isArray(indexRaw) ? indexRaw.map((x) => numberOf(x) ?? 0) : [0, size]; // the default covers every object

    // Read a big-endian field of `n` bytes; a width of 0 means "use the default" (type defaults to 1).
    const field = (at: number, n: number, dflt: number) => {
      if (n === 0) return dflt;
      let v = 0;
      for (let i = 0; i < n; i++) v = v * 256 + data[at + i];
      return v;
    };

    let row = 0;
    for (let s = 0; s + 1 < index.length; s += 2) {
      const first = index[s];
      const count = index[s + 1];
      for (let i = 0; i < count; i++, row++) {
        const at = row * rowLen;
        if (at + rowLen > data.length) return;
        const type = field(at, w[0], 1);
        const f2 = field(at + w[0], w[1], 0);
        const f3 = field(at + w[0] + w[1], w[2], 0);
        if (type === 1) this.note(first + i, { kind: "offset", offset: f2, gen: f3 });
        else if (type === 2) this.note(first + i, { kind: "inStream", stream: f2, index: f3 });
      }
    }
  }

  /** Record an entry unless a NEWER revision already claimed that object number. */
  private note(num: number, entry: XrefEntry): void {
    if (!this.xref.has(num)) this.xref.set(num, entry);
  }

  /**
   * Last resort: scan the whole file for `N G obj` headers and believe those. Used when the index is
   * missing or does not lead anywhere - and flagged via `recovered`, never silently.
   */
  private rebuildByScanning(): void {
    this.recovered = true;
    this.xref.clear();
    this.cache.clear();
    // Unpacked object streams belong to the index we just threw away; keeping them would serve members
    // resolved against offsets that no longer apply.
    this.objStmCache.clear();
    const text = new TextDecoder("latin1").decode(this.bytes);
    for (const m of text.matchAll(/(?:^|[\s>])(\d+)\s+(\d+)\s+obj\b/g)) {
      const num = Number(m[1]);
      // A later definition wins here: scanning walks the file forwards, and an incremental update
      // appends its newer version further down.
      this.xref.set(num, {
        kind: "offset",
        offset: (m.index ?? 0) + m[0].indexOf(m[1]),
        gen: Number(m[2]),
      });
    }
    // A scan only finds top-level `N G obj` headers, but in a modern file most objects - the catalog
    // included - live INSIDE an object stream. Unpack every /ObjStm we found so they can be reached at
    // all; without this, recovering a compressed file finds a handful of streams and no catalog.
    // A snapshot, not the live keys: the loop ADDS entries to the same map.
    const scanned = Array.from(this.xref.keys());
    for (const num of scanned) {
      const stm = this.getObject(num);
      if (stm === undefined || !isStream(stm) || nameOf(get(stm, "Type")) !== "ObjStm") continue;
      const data = this.streamData(stm);
      const head = new Lexer(data, 0);
      const count = numberOf(get(stm, "N")) ?? 0;
      for (let i = 0; i < count; i++) {
        const on = head.parse();
        const off = head.parse();
        if (typeof on !== "number" || typeof off !== "number") break;
        // A top-level definition found by the scan is the newer one and keeps precedence.
        this.note(on, { kind: "inStream", stream: num, index: i });
      }
    }

    if (this.trailer.map.size === 0 || this.trailer.map.get("Root") === undefined) {
      const t = /trailer\s*<</g;
      let last: RegExpExecArray | null, found: number | undefined;
      while ((last = t.exec(text)) !== null) found = last.index;
      if (found !== undefined) {
        const lx = new Lexer(this.bytes, found);
        lx.eatWord("trailer");
        const d = lx.parse();
        if (d !== undefined && isDict(d)) this.trailer = d;
      }
      // A file with only xref streams has no `trailer` keyword; its catalog is found by scanning.
      if (this.trailer.map.get("Root") === undefined) {
        for (const [num] of this.xref) {
          const o = this.getObject(num);
          if (o !== undefined && nameOf(get(o, "Type")) === "Catalog") {
            this.trailer.map.set("Root", { kind: "ref", num, gen: 0 });
            break;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Objects
  // -------------------------------------------------------------------------------------------

  /** The object with that number, or `undefined` when the file does not have it. */
  getObject(num: number): PdfObject | undefined {
    if (this.cache.has(num)) return this.cache.get(num);
    this.cache.set(num, undefined); // guard against a reference cycle while we resolve
    const entry = this.xref.get(num);
    let value: PdfObject | undefined;
    if (entry?.kind === "offset") value = this.parseObjectAt(entry.offset, num);
    else if (entry?.kind === "inStream") value = this.objectFromStream(entry.stream, num);
    this.cache.set(num, value);
    return value;
  }

  /** Parse `N G obj … endobj` at a byte offset, checking that it really is object `num`. */
  private parseObjectAt(offset: number, num: number): PdfObject | undefined {
    if (offset <= 0 || offset >= this.bytes.length) return undefined;
    const lx = new Lexer(this.bytes, offset);
    const n = lx.parse();
    lx.parse(); // generation
    if (n !== num || !lx.eatWord("obj")) return undefined;
    return lx.parse();
  }

  /** Unpack an object stream once, then serve its members from the cache. */
  private objectFromStream(streamNum: number, num: number): PdfObject | undefined {
    let members = this.objStmCache.get(streamNum);
    if (!members) {
      members = new Map();
      this.objStmCache.set(streamNum, members);
      const stm = this.getObject(streamNum);
      if (stm !== undefined && isStream(stm) && nameOf(get(stm, "Type")) === "ObjStm") {
        const data = this.streamData(stm);
        const count = numberOf(get(stm, "N")) ?? 0;
        const first = numberOf(get(stm, "First")) ?? 0;
        // The stream opens with `count` pairs of "object number, offset relative to /First".
        const head = new Lexer(data, 0);
        const pairs: Array<[number, number]> = [];
        for (let i = 0; i < count; i++) {
          const on = head.parse();
          const off = head.parse();
          if (typeof on !== "number" || typeof off !== "number") break;
          pairs.push([on, off]);
        }
        for (const [on, off] of pairs) {
          const o = new Lexer(data, first + off).parse();
          if (o !== undefined) members.set(on, o);
        }
      }
    }
    return members.get(num);
  }

  /** Follow indirect references until a direct object is reached. */
  resolve(o: PdfObject | undefined): PdfObject | undefined {
    let seen = 0;
    while (o !== undefined && isRef(o)) {
      if (++seen > 64) return undefined; // a cyclic file must not hang us
      o = this.getObject(o.num);
    }
    return o;
  }

  /** A dictionary entry, with the reference already followed. */
  lookup(o: PdfObject | undefined, key: string): PdfObject | undefined {
    return this.resolve(get(this.resolve(o), key));
  }

  /**
   * The file is password-protected. Every string and stream in it is enciphered, so anything read out
   * of it is ciphertext until a decryption path exists - which is why the form layer refuses rather
   * than handing back nonsense field names.
   */
  get isEncrypted(): boolean {
    return this.trailer.map.get("Encrypt") !== undefined;
  }

  /** True once the password has been accepted and the contents decrypted, so what is read is plaintext.
   *  Always true for a document that was never encrypted. */
  get isReadable(): boolean {
    return !this.isEncrypted || this.security !== undefined;
  }

  /**
   * Encipher a value that is about to be written back INTO this document, or `undefined` when the
   * document is not encrypted and the value goes in as it is.
   *
   * Needed because we decrypt everything on open: a string we then hand back to the writer is plaintext
   * in memory, and writing it into an encrypted file unchanged would both leak it and produce a document
   * that contradicts its own /Encrypt declaration.
   */
  async encryptForWrite(data: Uint8Array): Promise<Uint8Array | undefined> {
    return this.security ? this.security.encrypt(data) : undefined;
  }

  /**
   * Whether values written back into this document can be enciphered again.
   *
   * False for a legacy-encrypted file: we can READ RC4 and AES-128, but writing one would downgrade the
   * user's document to a broken cipher. Asked BEFORE any work is done - otherwise the refusal depends on
   * a string happening to be present in whatever we rewrite, which is a guarantee by accident.
   */
  get canReEncrypt(): boolean {
    return !this.isEncrypted || (this.security?.canEncrypt ?? false);
  }

  /** The generation of an object as the file records it. Members of an object stream are always 0. */
  generationOf(num: number): number {
    const entry = this.xref.get(num);
    return entry?.kind === "offset" ? entry.gen : 0;
  }

  get catalog(): PdfObject | undefined {
    const root = this.resolve(this.trailer.map.get("Root"));
    return root !== undefined && isDict(root) ? root : undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Stream data
  // -------------------------------------------------------------------------------------------

  /** A stream's bytes as they sit in the file: sliced by `/Length`, still filtered and still encrypted. */
  private rawStream(stream: PdfStream): Uint8Array {
    const length = numberOf(this.resolve(get(stream, "Length")));
    if (length !== undefined && stream.start + length <= this.bytes.length) {
      return this.bytes.subarray(stream.start, stream.start + length);
    }
    // A missing or wrong /Length happens; fall back to the next `endstream`.
    const text = new TextDecoder("latin1").decode(this.bytes);
    const end = text.indexOf("endstream", stream.start);
    return this.bytes.subarray(stream.start, end < 0 ? this.bytes.length : end);
  }

  /** A stream's DECODED bytes: deciphered if the document is encrypted, then run through its filters. */
  streamData(stream: PdfStream): Uint8Array {
    // A decrypted payload replaces the bytes from the file; filters then run on the plaintext, which is
    // the order the format prescribes - encryption wraps the already-filtered data.
    const raw = this.plainStreams.get(stream.start) ?? this.rawStream(stream);

    const filterRaw = this.resolve(get(stream, "Filter"));
    const filters = (Array.isArray(filterRaw) ? filterRaw : [filterRaw])
      .map((f) => nameOf(this.resolve(f)))
      .filter((f): f is string => f !== undefined);
    const parmsRaw = this.resolve(get(stream, "DecodeParms"));
    const parms = Array.isArray(parmsRaw) ? parmsRaw : [parmsRaw];

    let data = raw;
    filters.forEach((filter, i) => {
      if (filter === "FlateDecode") {
        try {
          // Per pass, because /Filter is a list and [/FlateDecode /FlateDecode] is a legal nested bomb.
          data = inflateBounded(data, this.maxStreamSize);
        } catch (e) {
          // A stream that blew the ceiling is an attack, not a stream we failed to decode - swallowing
          // it here would hand back silent garbage.
          if (e instanceof PdfStreamTooLargeError) throw e;
          return; // not our data to repair; hand back what we have
        }
        data = this.undoPredictor(data, this.resolve(parms[i]));
      }
      // Other filters (LZW, DCT, …) are left encoded on purpose: this reader only needs the structural
      // streams - the index, object streams and appearances - and every one of those is Flate.
    });
    return data;
  }

  /**
   * Undo a PNG predictor (`/Predictor` 10-15), which xref streams almost always use - the IRS form in
   * our fixtures does. Each row is prefixed with its filter type and is decoded against the row above.
   */
  private undoPredictor(data: Uint8Array, parms: PdfObject | undefined): Uint8Array {
    const predictor = numberOf(get(parms, "Predictor")) ?? 1;
    if (predictor < 10) return data; // 1 = none; 2 (TIFF) does not occur in the streams we read
    const colors = numberOf(get(parms, "Colors")) ?? 1;
    const bpc = numberOf(get(parms, "BitsPerComponent")) ?? 8;
    const columns = numberOf(get(parms, "Columns")) ?? 1;
    const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
    const rowLen = Math.ceil((colors * bpc * columns) / 8);

    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    let prev = new Uint8Array(rowLen);
    for (let r = 0; r < rows; r++) {
      const type = data[r * (rowLen + 1)];
      const src = data.subarray(r * (rowLen + 1) + 1, (r + 1) * (rowLen + 1));
      const row = out.subarray(r * rowLen, (r + 1) * rowLen);
      for (let i = 0; i < rowLen; i++) {
        const a = i >= bpp ? row[i - bpp] : 0; // left
        const b = prev[i]; // up
        const c = i >= bpp ? prev[i - bpp] : 0; // upper left
        const x = src[i];
        switch (type) {
          case 0:
            row[i] = x;
            break;
          case 1:
            row[i] = (x + a) & 0xff;
            break;
          case 2:
            row[i] = (x + b) & 0xff;
            break;
          case 3:
            row[i] = (x + ((a + b) >> 1)) & 0xff;
            break;
          case 4: {
            const p = a + b - c;
            const pa = Math.abs(p - a),
              pb = Math.abs(p - b),
              pc = Math.abs(p - c);
            row[i] = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
            break;
          }
          default:
            row[i] = x;
        }
      }
      prev = row;
    }
    return out;
  }

  /** Every object number the index knows, ascending - for walking a whole document. */
  objectNumbers(): number[] {
    return [...this.xref.keys()].sort((a, b) => a - b);
  }
}

export { EMPTY };

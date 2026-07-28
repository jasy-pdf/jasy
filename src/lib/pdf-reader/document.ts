import { unzlibSync } from "fflate";
import { Lexer } from "./lexer.ts";
import {
  get,
  isDict,
  isRef,
  isStream,
  nameOf,
  numberOf,
  type PdfDict,
  type PdfObject,
  type PdfStream,
} from "./objects.ts";

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

export class PdfDocument {
  private readonly xref = new Map<number, XrefEntry>();
  private readonly cache = new Map<number, PdfObject | undefined>();
  /** Object streams already unpacked, by their object number. */
  private readonly objStmCache = new Map<number, Map<number, PdfObject>>();
  /** True when the cross-reference index was unusable and had to be rebuilt by scanning. Surfaced so
   *  a caller can report it - a silently repaired file is exactly the kind of guess we avoid. */
  recovered = false;
  trailer: PdfDict = { kind: "dict", map: new Map() };

  private constructor(readonly bytes: Uint8Array) {}

  static load(bytes: Uint8Array): PdfDocument {
    const doc = new PdfDocument(bytes);
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

  get catalog(): PdfObject | undefined {
    const root = this.resolve(this.trailer.map.get("Root"));
    return root !== undefined && isDict(root) ? root : undefined;
  }

  // -------------------------------------------------------------------------------------------
  // Stream data
  // -------------------------------------------------------------------------------------------

  /** A stream's DECODED bytes: sliced with the resolved `/Length`, then run through its filters. */
  streamData(stream: PdfStream): Uint8Array {
    const length = numberOf(this.resolve(get(stream, "Length")));
    let raw: Uint8Array;
    if (length !== undefined && stream.start + length <= this.bytes.length) {
      raw = this.bytes.subarray(stream.start, stream.start + length);
    } else {
      // A missing or wrong /Length happens; fall back to the next `endstream`.
      const text = new TextDecoder("latin1").decode(this.bytes);
      const end = text.indexOf("endstream", stream.start);
      raw = this.bytes.subarray(stream.start, end < 0 ? this.bytes.length : end);
    }

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
          data = unzlibSync(data);
        } catch {
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

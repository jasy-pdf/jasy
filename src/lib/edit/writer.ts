import type { PdfDocument } from "./document.ts";
import { isDict, isRef, isStream, isString, type PdfObject } from "./objects.ts";

/**
 * Writing changes back into an existing PDF, as an **incremental update**.
 *
 * The original bytes are never rewritten. Changed objects are APPENDED, followed by a fresh
 * cross-reference section whose `/Prev` points back at the old one. That is what the format was designed
 * for, and it buys three things: we never have to understand (let alone re-emit) the parts of a foreign
 * file we did not come for; an existing signature over the original bytes stays intact; and the result
 * carries a property worth testing - **the original file is a literal PREFIX of the output**.
 */

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * A PDF string, written back byte-faithfully.
 *
 * Only printable ASCII goes into a `(literal)`. Anything else becomes a `<hex>` string, which carries
 * the SAME bytes but survives the UTF-8 encoder this file is finally written through - a literal holding
 * byte 0xE4 would otherwise leave as the two bytes 0xC3 0xA4 and read back as mojibake.
 */
const stringToken = (b: Uint8Array): string => {
  const printable = b.every((byte) => byte >= 0x20 && byte <= 0x7e);
  if (!printable) {
    return `<${Array.from(b, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("")}>`;
  }
  let out = "";
  for (const byte of b) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += "\\" + String.fromCharCode(byte);
    else out += String.fromCharCode(byte);
  }
  return `(${out})`;
};

/** Escape a PDF name: everything outside the regular characters becomes `#XX`. */
const escNameToken = (s: string): string =>
  Array.from(enc(s))
    .map((b) =>
      b >= 0x21 && b <= 0x7e && !"()<>[]{}/%#".includes(String.fromCharCode(b))
        ? String.fromCharCode(b)
        : "#" + b.toString(16).padStart(2, "0").toUpperCase(),
    )
    .join("");

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(6))));

/**
 * Serialise an object back to PDF syntax. Used only for objects we deliberately change - everything we
 * do not touch stays in the original bytes, untouched and unre-encoded.
 *
 * A string keeps the spelling it was read with: a name written as `<FEFF…>` stays hex, because that is
 * how the producer encodes unicode and rewriting it as a literal would corrupt it.
 */
export function serialize(o: PdfObject | undefined): string {
  if (o === undefined || o === null) return "null";
  if (typeof o === "number") return num(o);
  if (typeof o === "boolean") return String(o);
  if (Array.isArray(o)) return `[${o.map(serialize).join(" ")}]`;
  if (isRef(o)) return `${o.num} ${o.gen} R`;
  if (isString(o)) {
    // A string the producer wrote as hex stays hex; the rest is decided by its bytes.
    return o.hex
      ? `<${Array.from(o.bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("")}>`
      : stringToken(o.bytes);
  }
  if (isStream(o)) return `${serialize(o.dict)}\nstream\n<<stream data>>\nendstream`;
  if (isDict(o)) {
    const parts: string[] = [];
    for (const [k, v] of o.map) parts.push(`/${escNameToken(k)} ${serialize(v)}`);
    return `<< ${parts.join(" ")} >>`;
  }
  return `/${escNameToken(o.name)}`;
}

/** A stream we are adding: its dictionary entries plus the raw (already encoded) data. */
export interface NewStream {
  dict: string;
  data: Uint8Array;
}

export class IncrementalWriter {
  /** Object number -> its new body, in PDF syntax. */
  private readonly changed = new Map<number, string | NewStream>();
  /** Numbers this writer invented, as opposed to ones it replaces - they have no recorded generation. */
  private readonly added = new Set<number>();
  private nextNum: number;

  constructor(private readonly doc: PdfDocument) {
    // New objects continue after the highest number the file already uses.
    this.nextNum = Math.max(0, ...doc.objectNumbers()) + 1;
  }

  /** Replace an existing object. */
  update(objNum: number, body: string | NewStream): void {
    this.changed.set(objNum, body);
  }

  /** Append a new object and return its number. */
  add(body: string | NewStream): number {
    const n = this.nextNum++;
    this.added.add(n);
    this.changed.set(n, body);
    return n;
  }

  /** The generation to write for an object: the file's own for one we replace, 0 for one we add. */
  private generationOf(objNum: number): number {
    return this.added.has(objNum) ? 0 : this.doc.generationOf(objNum);
  }

  get hasChanges(): boolean {
    return this.changed.size > 0;
  }

  /**
   * Produce the updated file: the original bytes, then every changed object, then a new cross-reference
   * section chained to the old one.
   */
  save(): Uint8Array {
    if (this.changed.size === 0) return this.doc.bytes;

    const original = this.doc.bytes;
    const chunks: Uint8Array[] = [original];
    let offset = original.length;
    // A file that does not end in a newline would run its last line into our first object.
    if (original[original.length - 1] !== 10 && original[original.length - 1] !== 13) {
      chunks.push(enc("\n"));
      offset += 1;
    }

    const offsets = new Map<number, number>();
    for (const [objNum, body] of [...this.changed].sort((a, b) => a[0] - b[0])) {
      offsets.set(objNum, offset);
      // The generation has to match what the file records, or the new entry describes a different
      // object than the one being replaced. Objects we ADD are new numbers, and those start at 0.
      const head = enc(`${objNum} ${this.generationOf(objNum)} obj\n`);
      chunks.push(head);
      offset += head.length;
      if (typeof body === "string") {
        const b = enc(`${body}\nendobj\n`);
        chunks.push(b);
        offset += b.length;
      } else {
        const open = enc(`<< ${body.dict} /Length ${body.data.length} >>\nstream\n`);
        const close = enc(`\nendstream\nendobj\n`);
        chunks.push(open, body.data, close);
        offset += open.length + body.data.length + close.length;
      }
    }

    const xrefOffset = offset;
    chunks.push(this.xrefSection(offsets, xrefOffset));

    let total = 0;
    for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }

  /**
   * The new cross-reference section, as BYTES.
   *
   * Bytes, not a string: an xref stream is binary, and running it through a UTF-8 encoder would turn
   * every value above 127 into two bytes - which is most offsets, so the whole index becomes garbage.
   *
   * A classic table is written when the file already had one; an xref-STREAM file gets a stream,
   * because mixing the two leaves readers that follow only one kind unable to walk the chain back.
   */
  private xrefSection(offsets: Map<number, number>, xrefOffset: number): Uint8Array {
    const prev = this.previousStartXref();
    const rootRef = this.doc.trailer.map.get("Root");
    const idRef = this.doc.trailer.map.get("ID");
    const infoRef = this.doc.trailer.map.get("Info");

    // An xref stream is itself an object and has to appear in its own index, so its number is taken
    // first and its offset is where this whole section begins.
    const all = new Map(offsets);
    let selfNum: number | undefined;
    if (this.doc.usesXrefStream) {
      selfNum = this.nextNum++;
      all.set(selfNum, xrefOffset);
    }
    const size = Math.max(this.nextNum, ...all.keys()) + 1;

    // Group consecutive object numbers into subsections, which is what both formats want.
    const nums = [...all.keys()].sort((a, b) => a - b);
    const runs: Array<[number, number[]]> = [];
    for (const n of nums) {
      const last = runs[runs.length - 1];
      if (last && n === last[0] + last[1].length) last[1].push(n);
      else runs.push([n, [n]]);
    }
    const entry = (key: string, ref: PdfObject | undefined) =>
      ref === undefined ? "" : `${key} ${serialize(ref)}`;

    if (selfNum !== undefined) {
      // Rows of `/W [1 4 2]`: in-use marker, 4-byte offset, 2-byte generation. Left uncompressed - a
      // filter is optional, and a readable appended section is worth more here than a few hundred bytes.
      const rows = new Uint8Array(nums.length * 7);
      nums.forEach((n, i) => {
        const off = all.get(n)!;
        const g = n === selfNum ? 0 : this.generationOf(n);
        rows.set(
          [
            1,
            (off >>> 24) & 0xff,
            (off >>> 16) & 0xff,
            (off >>> 8) & 0xff,
            off & 0xff,
            (g >>> 8) & 0xff,
            g & 0xff,
          ],
          i * 7,
        );
      });
      const index = runs.map(([start, group]) => `${start} ${group.length}`).join(" ");
      const dict = [
        "/Type /XRef",
        `/Size ${size}`,
        `/Index [${index}]`,
        "/W [1 4 2]",
        entry("/Root", rootRef),
        entry("/Info", infoRef),
        entry("/ID", idRef),
        prev !== undefined ? `/Prev ${prev}` : "",
        `/Length ${rows.length}`,
      ].filter(Boolean);
      const head = enc(`${selfNum} 0 obj\n<< ${dict.join(" ")} >>\nstream\n`);
      const tail = enc(`\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF\n`);
      const out = new Uint8Array(head.length + rows.length + tail.length);
      out.set(head, 0);
      out.set(rows, head.length);
      out.set(tail, head.length + rows.length);
      return out;
    }

    let table = "xref\n";
    for (const [start, group] of runs) {
      table += `${start} ${group.length}\n`;
      for (const n of group) {
        const g = String(this.generationOf(n)).padStart(5, "0");
        table += `${String(all.get(n)).padStart(10, "0")} ${g} n \n`;
      }
    }
    const trailer = [
      `/Size ${size}`,
      entry("/Root", rootRef),
      entry("/Info", infoRef),
      entry("/ID", idRef),
      prev !== undefined ? `/Prev ${prev}` : "",
    ].filter(Boolean);
    return enc(`${table}trailer\n<< ${trailer.join(" ")} >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  }

  /** The offset the ORIGINAL file's `startxref` pointed at - our `/Prev`. */
  private previousStartXref(): number | undefined {
    const tail = new TextDecoder("latin1").decode(
      this.doc.bytes.subarray(Math.max(0, this.doc.bytes.length - 2048)),
    );
    const at = tail.lastIndexOf("startxref");
    if (at < 0) return undefined;
    const m = /startxref\s+(\d+)/.exec(tail.slice(at));
    return m ? Number(m[1]) : undefined;
  }
}

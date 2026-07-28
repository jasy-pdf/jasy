import type { PdfDict, PdfObject } from "./objects.ts";

const EMPTY = new Uint8Array(0);

/**
 * The PDF object parser: bytes in, `PdfObject` out.
 *
 * It works on a `Uint8Array` with an explicit cursor rather than on a decoded string, because a PDF is
 * binary - a literal string may hold any byte, and a stream certainly does. Decoding to text first
 * would corrupt exactly the data we came for.
 *
 * Scope: enough of the grammar to walk a document to its `/AcroForm`. No content-stream operators, no
 * function/shading evaluation - those are a renderer's job, not a form reader's.
 */

// PDF whitespace (7.2.2): null, tab, LF, FF, CR, space.
const isSpace = (c: number) => c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
// Delimiters (7.2.2) - they end a token even without whitespace.
const isDelim = (c: number) =>
  c === 0x28 ||
  c === 0x29 ||
  c === 0x3c ||
  c === 0x3e ||
  c === 0x5b ||
  c === 0x5d ||
  c === 0x7b ||
  c === 0x7d ||
  c === 0x2f ||
  c === 0x25;
const isRegular = (c: number) => !isSpace(c) && !isDelim(c);
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;
const hexVal = (c: number) =>
  c >= 0x30 && c <= 0x39
    ? c - 0x30
    : c >= 0x41 && c <= 0x46
      ? c - 55
      : c >= 0x61 && c <= 0x66
        ? c - 87
        : -1;

export class Lexer {
  constructor(
    readonly bytes: Uint8Array,
    public pos = 0,
  ) {}

  /** Skip whitespace and comments (`%` to end of line). */
  skip(): void {
    for (;;) {
      while (this.pos < this.bytes.length && isSpace(this.bytes[this.pos])) this.pos++;
      if (this.bytes[this.pos] !== 0x25) return; // '%'
      while (
        this.pos < this.bytes.length &&
        this.bytes[this.pos] !== 10 &&
        this.bytes[this.pos] !== 13
      )
        this.pos++;
    }
  }

  /** The next bare token (a keyword like `obj`, `R`, `endstream`), without consuming delimiters. */
  private word(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos])) this.pos++;
    return new TextDecoder("latin1").decode(this.bytes.subarray(start, this.pos));
  }

  /** True when the bytes at the cursor spell `word` (after whitespace). Does not consume. */
  peekWord(word: string): boolean {
    const save = this.pos;
    this.skip();
    const w = this.word();
    this.pos = save;
    return w === word;
  }

  /** Consume `word` if present; report whether it was. */
  eatWord(word: string): boolean {
    const save = this.pos;
    this.skip();
    if (this.word() === word) return true;
    this.pos = save;
    return false;
  }

  /**
   * Parse one object at the cursor. Returns `undefined` at end of input or on a token this reader does
   * not model - the caller treats that as "not something I can work with" rather than crashing.
   */
  parse(): PdfObject | undefined {
    this.skip();
    if (this.pos >= this.bytes.length) return undefined;
    const c = this.bytes[this.pos];

    if (c === 0x2f) return this.name();
    if (c === 0x28) return this.literalString();
    if (c === 0x5b) return this.array();
    if (c === 0x3c) {
      return this.bytes[this.pos + 1] === 0x3c ? this.dictOrStream() : this.hexString();
    }
    if (isDigit(c) || c === 0x2b || c === 0x2d || c === 0x2e) return this.numberOrRef();

    const w = this.word();
    if (w === "true") return true;
    if (w === "false") return false;
    if (w === "null") return null;
    return undefined; // an unmodelled keyword; the caller decides
  }

  /** `/Name`, with `#XX` escapes decoded (a font or field name may hold `#20` for a space). */
  private name(): PdfObject {
    this.pos++; // '/'
    let out = "";
    while (this.pos < this.bytes.length && isRegular(this.bytes[this.pos])) {
      const b = this.bytes[this.pos++];
      if (b === 0x23 && this.pos + 1 < this.bytes.length) {
        const hi = hexVal(this.bytes[this.pos]);
        const lo = hexVal(this.bytes[this.pos + 1]);
        if (hi >= 0 && lo >= 0) {
          out += String.fromCharCode((hi << 4) | lo);
          this.pos += 2;
          continue;
        }
      }
      out += String.fromCharCode(b);
    }
    return { kind: "name", name: out };
  }

  /** `(text)`: balanced nested parens, backslash escapes, and the line continuation. */
  private literalString(): PdfObject {
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.bytes.length) {
      const b = this.bytes[this.pos++];
      if (b === 0x5c) {
        // backslash
        const e = this.bytes[this.pos++];
        const simple: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
        if (e in simple) out.push(simple[e]);
        else if (e >= 0x30 && e <= 0x37) {
          // up to three octal digits
          let v = e - 0x30;
          for (
            let i = 0;
            i < 2 && this.bytes[this.pos] >= 0x30 && this.bytes[this.pos] <= 0x37;
            i++
          )
            v = v * 8 + (this.bytes[this.pos++] - 0x30);
          out.push(v & 0xff);
        } else if (e === 10) {
          /* line continuation: the newline is dropped */
        } else if (e === 13) {
          if (this.bytes[this.pos] === 10) this.pos++;
        } else out.push(e);
        continue;
      }
      // An UNESCAPED end-of-line inside a literal is a line break, not data: CR, LF and CRLF all mean
      // one LF (7.3.4.2). Passing a CR through verbatim would quietly change the value of any field
      // written across two lines.
      if (b === 13) {
        if (this.bytes[this.pos] === 10) this.pos++;
        out.push(10);
        continue;
      }
      if (b === 0x28) depth++;
      if (b === 0x29 && --depth === 0) break;
      out.push(b);
    }
    return { kind: "string", bytes: new Uint8Array(out), hex: false };
  }

  /** `<48656C6C6F>`: hex digits, whitespace ignored, an odd final digit padded with 0. */
  private hexString(): PdfObject {
    this.pos++; // '<'
    const out: number[] = [];
    let hi = -1;
    while (this.pos < this.bytes.length) {
      const b = this.bytes[this.pos++];
      if (b === 0x3e) break; // '>'
      const v = hexVal(b);
      if (v < 0) continue; // whitespace or junk inside a hex string is ignored
      if (hi < 0) hi = v;
      else {
        out.push((hi << 4) | v);
        hi = -1;
      }
    }
    if (hi >= 0) out.push(hi << 4);
    return { kind: "string", bytes: new Uint8Array(out), hex: true };
  }

  private array(): PdfObject {
    this.pos++; // '['
    const out: PdfObject[] = [];
    for (;;) {
      this.skip();
      if (this.pos >= this.bytes.length) break;
      if (this.bytes[this.pos] === 0x5d) {
        this.pos++;
        break;
      }
      const before = this.pos;
      const v = this.parse();
      if (v === undefined) {
        // An unmodelled token inside an array: step past it so we cannot spin forever.
        if (this.pos === before) this.pos++;
        continue;
      }
      out.push(v);
    }
    return out;
  }

  /** `<< … >>`, followed by `stream` when it is a stream object. */
  private dictOrStream(): PdfObject {
    this.pos += 2; // '<<'
    const map = new Map<string, PdfObject>();
    for (;;) {
      this.skip();
      if (this.pos >= this.bytes.length) break;
      if (this.bytes[this.pos] === 0x3e && this.bytes[this.pos + 1] === 0x3e) {
        this.pos += 2;
        break;
      }
      if (this.bytes[this.pos] !== 0x2f) {
        // Not a key where one belongs - skip a token rather than loop.
        const before = this.pos;
        if (this.parse() === undefined && this.pos === before) this.pos++;
        continue;
      }
      const key = this.name();
      const value = this.parse();
      if (value !== undefined) map.set((key as { name: string }).name, value);
    }
    const dict: PdfDict = { kind: "dict", map };

    // A stream follows its dictionary. Its length is in /Length, which is allowed to be an indirect
    // reference - resolving that needs the whole document, so we only record where the data starts and
    // let the document layer slice it.
    const save = this.pos;
    if (this.eatWord("stream")) {
      if (this.bytes[this.pos] === 13) this.pos++;
      if (this.bytes[this.pos] === 10) this.pos++;
      return { kind: "stream", dict, start: this.pos, raw: EMPTY };
    }
    this.pos = save;
    return dict;
  }

  /** A number, or an indirect reference when the shape is `int int R`. */
  private numberOrRef(): PdfObject {
    const start = this.pos;
    if (this.bytes[this.pos] === 0x2b || this.bytes[this.pos] === 0x2d) this.pos++;
    while (
      this.pos < this.bytes.length &&
      (isDigit(this.bytes[this.pos]) || this.bytes[this.pos] === 0x2e)
    )
      this.pos++;
    const text = new TextDecoder("latin1").decode(this.bytes.subarray(start, this.pos));
    const value = Number(text);

    // Look ahead for `<gen> R`; restore the cursor when it is not there.
    if (Number.isInteger(value) && value >= 0 && !text.includes(".")) {
      const save = this.pos;
      this.skip();
      const genStart = this.pos;
      while (this.pos < this.bytes.length && isDigit(this.bytes[this.pos])) this.pos++;
      if (this.pos > genStart) {
        const gen = Number(
          new TextDecoder("latin1").decode(this.bytes.subarray(genStart, this.pos)),
        );
        if (this.eatWord("R")) return { kind: "ref", num: value, gen };
      }
      this.pos = save;
    }
    return value;
  }
}

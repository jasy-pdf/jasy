/**
 * The PDF object model, as READ from an existing file - the counterpart of the writer's string
 * building. Deliberately small: this reader exists to find and change an `/AcroForm`, not to model
 * every corner of the format.
 *
 * Values stay close to the bytes on purpose. A PDF string is kept as RAW BYTES rather than a JS string,
 * because its encoding is not known until you look at it (a literal may be PDFDocEncoded, a hex string
 * is often UTF-16BE with a BOM - pdf-lib writes every field name that way). Decoding early would lose
 * the distinction and mangle names.
 */

export interface PdfName {
  kind: "name";
  /** The name WITHOUT the leading slash, `#XX` already decoded. */
  name: string;
}

export interface PdfString {
  kind: "string";
  bytes: Uint8Array;
  /** True when it was written as `<hex>` rather than `(literal)`. Kept for faithful round-tripping. */
  hex: boolean;
}

/** An indirect reference, `12 0 R`. Resolved against the document, never followed by the parser itself. */
export interface PdfRef {
  kind: "ref";
  num: number;
  gen: number;
}

export interface PdfDict {
  kind: "dict";
  map: Map<string, PdfObject>;
}

/**
 * A stream: its dictionary plus the RAW (still encoded) bytes between `stream` and `endstream`.
 *
 * The parser records only where the data STARTS, because the length lives in `/Length`, which is itself
 * allowed to be an indirect reference - resolving it needs the whole document. The document layer fills
 * `raw` once it can.
 */
export interface PdfStream {
  kind: "stream";
  dict: PdfDict;
  /** Byte offset of the first data byte (just past the EOL after the `stream` keyword). */
  start: number;
  /** The still-encoded bytes; empty until the document resolves `/Length`. */
  raw: Uint8Array;
}

export type PdfObject =
  | number
  | boolean
  | null
  | PdfName
  | PdfString
  | PdfRef
  | PdfDict
  | PdfStream
  | PdfObject[];

// ---------------------------------------------------------------------------------------------
// Narrowing helpers. Reading a foreign PDF means every lookup can legitimately come back missing or
// of the wrong type, so these all answer `undefined` rather than throwing - the caller decides what
// is fatal.
// ---------------------------------------------------------------------------------------------

// The guards take an OPTIONAL object on purpose: they are nearly always applied to the result of a
// lookup that may find nothing (`isRef(get(o, "AP"))`), and a missing entry simply is not of the type.
export const isName = (o: PdfObject | undefined): o is PdfName =>
  typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "name";

export const isString = (o: PdfObject | undefined): o is PdfString =>
  typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "string";

export const isRef = (o: PdfObject | undefined): o is PdfRef =>
  typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "ref";

export const isDict = (o: PdfObject | undefined): o is PdfDict =>
  typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "dict";

export const isStream = (o: PdfObject | undefined): o is PdfStream =>
  typeof o === "object" && o !== null && !Array.isArray(o) && o.kind === "stream";

/** A dictionary entry, by key without the slash. Reads through a stream to its dictionary, since the
 *  two are asked the same questions (`/Type`, `/Length`, …). */
export function get(o: PdfObject | undefined, key: string): PdfObject | undefined {
  if (o === undefined) return undefined;
  if (isStream(o)) return o.dict.map.get(key);
  if (isDict(o)) return o.map.get(key);
  return undefined;
}

export const nameOf = (o: PdfObject | undefined): string | undefined =>
  o !== undefined && isName(o) ? o.name : undefined;

export const numberOf = (o: PdfObject | undefined): number | undefined =>
  typeof o === "number" ? o : undefined;

/**
 * A PDF text string as JS text. Two encodings live side by side in the wild: UTF-16BE, marked by a
 * `FE FF` byte-order mark (what pdf-lib writes for every field name), and otherwise PDFDocEncoding,
 * which agrees with Latin-1 for everything a field name realistically holds.
 */
export function textOf(o: PdfObject | undefined): string | undefined {
  if (o === undefined || !isString(o)) return undefined;
  const b = o.bytes;
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    let s = "";
    for (let i = 2; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
  }
  return new TextDecoder("latin1").decode(b);
}

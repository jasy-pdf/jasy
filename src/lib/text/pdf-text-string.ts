/**
 * PDF text strings - a title, a bookmark, alt text, a field value, an attachment's name - in both
 * directions, from ONE table.
 *
 * A text string is PDFDocEncoding or UTF-16BE with a byte-order mark (PDF 2.0 adds UTF-8 with one).
 * PDFDocEncoding is NOT Windows-1252: byte 0x96 is an en dash in Windows-1252 and "Œ" here, 0x80 is "€"
 * there and "•" here. A writer that sends text through the Windows-1252 page encoder therefore shows
 * "Preis – 5 €" as "Preis Œ 5 •".
 */

/** PDFDocEncoding where it differs from Latin-1 (ISO 32000-1, Annex D); 0x9F and 0xAD are undefined. */
const PDF_DOC: Record<number, number> = {
  0x18: 0x02d8,
  0x19: 0x02c7,
  0x1a: 0x02c6,
  0x1b: 0x02d9,
  0x1c: 0x02dd,
  0x1d: 0x02db,
  0x1e: 0x02da,
  0x1f: 0x02dc,
  0x80: 0x2022,
  0x81: 0x2020,
  0x82: 0x2021,
  0x83: 0x2026,
  0x84: 0x2014,
  0x85: 0x2013,
  0x86: 0x0192,
  0x87: 0x2044,
  0x88: 0x2039,
  0x89: 0x203a,
  0x8a: 0x2212,
  0x8b: 0x2030,
  0x8c: 0x201e,
  0x8d: 0x201c,
  0x8e: 0x201d,
  0x8f: 0x2018,
  0x90: 0x2019,
  0x91: 0x201a,
  0x92: 0x2122,
  0x93: 0xfb01,
  0x94: 0xfb02,
  0x95: 0x0141,
  0x96: 0x0152,
  0x97: 0x0160,
  0x98: 0x0178,
  0x99: 0x017d,
  0x9a: 0x0131,
  0x9b: 0x0142,
  0x9c: 0x0153,
  0x9d: 0x0161,
  0x9e: 0x017e,
  0xa0: 0x20ac,
};
const FROM_UNICODE = new Map(Object.entries(PDF_DOC).map(([byte, cp]) => [cp, Number(byte)]));
/** Latin-1 code points that mean something else in PDFDocEncoding, or nothing. */
const NOT_LATIN1 = new Set([...Object.keys(PDF_DOC).map(Number), 0x9f, 0xad]);

/** A text string's bytes: PDFDocEncoding when it can say everything, otherwise UTF-16BE with its BOM. */
export function encodePdfText(text: string): Uint8Array {
  const doc: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const byte = cp <= 0xff && !NOT_LATIN1.has(cp) ? cp : FROM_UNICODE.get(cp);
    if (byte === undefined) return utf16be(text);
    doc.push(byte);
  }
  return Uint8Array.from(doc);
}

function utf16be(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xfe;
  out[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    out[2 + i * 2] = unit >> 8;
    out[3 + i * 2] = unit & 0xff;
  }
  return out;
}

/** A text string's meaning: UTF-16BE or UTF-8 by their byte-order mark, otherwise PDFDocEncoding. */
export function decodePdfText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder().decode(bytes.subarray(3));
  }
  let s = "";
  for (const byte of bytes) s += String.fromCodePoint(PDF_DOC[byte] ?? byte);
  return s;
}

/**
 * Whether `text` can be written as a plain `(literal)` that the Windows-1252 page encoder turns into the
 * same bytes PDFDocEncoding reads back: printable ASCII and the Latin-1 letters both encodings share.
 */
export function isPlainPdfText(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const ascii = (c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d;
    if (!ascii && !(c >= 0xa1 && c <= 0xff && c !== 0xad)) return false;
  }
  return true;
}

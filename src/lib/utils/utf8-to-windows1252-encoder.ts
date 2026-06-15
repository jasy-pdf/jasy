// Windows-1252 equals Latin-1 (codepoint == byte) EXCEPT in 0x80-0x9F, where it carries
// printable punctuation - the Euro sign, smart quotes, dashes, ellipsis, ... - instead of
// C1 controls. Those glyphs sit at Unicode codepoints far outside 0x00-0xFF, so a naive
// low-byte cast turns "€" (U+20AC) into 0xAC ("¬"). This table maps each back to its
// Windows-1252 byte. (The font metrics already resolve these via the Adobe Glyph List, so
// only the emitted byte was wrong.)
const CP1252_FROM_UNICODE: Record<number, number> = {
  0x20ac: 0x80, // € Euro
  0x201a: 0x82, // ‚ single low-9 quote
  0x0192: 0x83, // ƒ florin
  0x201e: 0x84, // „ double low-9 quote
  0x2026: 0x85, // … ellipsis
  0x2020: 0x86, // † dagger
  0x2021: 0x87, // ‡ double dagger
  0x02c6: 0x88, // ˆ circumflex
  0x2030: 0x89, // ‰ per mille
  0x0160: 0x8a, // Š S caron
  0x2039: 0x8b, // ‹ single left angle quote
  0x0152: 0x8c, // Œ OE ligature
  0x017d: 0x8e, // Ž Z caron
  0x2018: 0x91, // ' left single quote
  0x2019: 0x92, // ' right single quote
  0x201c: 0x93, // " left double quote
  0x201d: 0x94, // " right double quote
  0x2022: 0x95, // • bullet
  0x2013: 0x96, // – en dash
  0x2014: 0x97, // — em dash
  0x02dc: 0x98, // ˜ small tilde
  0x2122: 0x99, // ™ trademark
  0x0161: 0x9a, // š s caron
  0x203a: 0x9b, // › single right angle quote
  0x0153: 0x9c, // œ oe ligature
  0x017e: 0x9e, // ž z caron
  0x0178: 0x9f, // Ÿ Y diaeresis
};

/** Encodes a JavaScript string to a Windows-1252 byte buffer (the PDF text encoding). */
export function getArrayBuffer(data: string): ArrayBuffer {
  const u8 = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code <= 0xff) {
      u8[i] = code; // Latin-1 range: codepoint is the Windows-1252 byte
    } else if (CP1252_FROM_UNICODE[code] !== undefined) {
      u8[i] = CP1252_FROM_UNICODE[code];
    } else {
      u8[i] = 0x3f; // "?" - not representable in Windows-1252
    }
  }
  return u8.buffer;
}

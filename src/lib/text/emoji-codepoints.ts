// Whether a code point is (very likely) an emoji, used ONLY by the image/CDN emoji source: unlike a
// font source, there is no font to ask "do you have a color glyph for this?", so we decide from the
// well-known emoji blocks. This is a curated, dependency-free subset - it covers the emoji people
// actually type, not the full Unicode Emoji property list, and intentionally errs toward the common
// blocks. A font source does NOT use this (it asks the font).

// [lo, hi] inclusive ranges of the main emoji / pictograph blocks.
const RANGES: readonly [number, number][] = [
  [0x1f000, 0x1faff], // Mahjong/Dominoes/Cards, Misc Symbols & Pictographs, Emoticons, Transport,
  //                     Supplemental Symbols & Pictographs, Symbols & Pictographs Extended-A (incl. flags)
  [0x2190, 0x21ff], // Arrows
  [0x2300, 0x23ff], // Misc Technical (⌚ ⏰ ⏳, media controls)
  [0x2460, 0x24ff], // Enclosed Alphanumerics (Ⓜ)
  [0x25a0, 0x25ff], // Geometric Shapes (▪ ◼ ⬛)
  [0x2600, 0x27bf], // Misc Symbols + Dingbats (☀ ★ ✂ ✅ ✈ ✉ ✊ ✋)
  [0x2900, 0x297f], // Supplemental Arrows-B (⤴ ⤵)
  [0x2b00, 0x2bff], // Misc Symbols and Arrows (⭐ ⬅ ⬛)
  [0x3000, 0x303f], // CJK Symbols and Punctuation (〰 〽)
  [0x3200, 0x32ff], // Enclosed CJK Letters and Months (㊗ ㊙)
];

// Emoji-presentation singletons outside the ranges above.
const SINGLES = new Set([0x00a9, 0x00ae, 0x203c, 0x2049, 0x2122, 0x2139, 0xfe0f]);

export function isEmojiCodePoint(codePoint: number): boolean {
  if (SINGLES.has(codePoint)) return true;
  for (const [lo, hi] of RANGES) if (codePoint >= lo && codePoint <= hi) return true;
  return false;
}

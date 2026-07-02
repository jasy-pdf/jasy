import { describe, it, expect } from "vitest";
import { isEmojiCodePoint } from "../../../src/lib/text/emoji-codepoints";

const cp = (s: string): number => s.codePointAt(0)!;

describe("isEmojiCodePoint", () => {
  it("recognizes common emoji (astral + BMP symbols)", () => {
    for (const e of ["😀", "🚀", "🎉", "🦄", "🔥", "❤", "⭐", "✅", "☀"]) {
      expect(isEmojiCodePoint(cp(e))).toBe(true);
    }
  });

  it("does not treat letters/digits/punctuation as emoji", () => {
    for (const c of ["A", "z", "5", "ä", "ß", " ", ".", "-", "€"]) {
      expect(isEmojiCodePoint(cp(c))).toBe(false);
    }
  });
});

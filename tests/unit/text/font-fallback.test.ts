import { describe, it, expect } from "vitest";
import { splitByFont } from "../../../src/lib/text/font-fallback.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// A fallback stack picks, per CODE POINT, the first family that can draw it. The stand-in below says
// "Latin" holds ASCII only and "CJK" holds everything else, so a test reads as script coverage rather
// than as glyph ids.

const metrics = testMetrics({
  hasGlyph: (cp, family) => (family === "Latin" ? cp < 0x80 : true),
});

const split = (text: string, stack: string[]) =>
  splitByFont(text, stack[0], stack.slice(1), FontStyle.Normal, metrics);

describe("nothing to fall back to", () => {
  it("returns undefined without a stack, so the old path is kept", () => {
    expect(split("abc", ["Latin"])).toBeUndefined();
  });

  it("returns undefined when the first family draws everything", () => {
    expect(split("abc", ["Latin", "CJK"])).toBeUndefined();
  });
});

describe("a code point the first family cannot draw", () => {
  it("goes to the next family in the stack", () => {
    expect(split("abc漢字", ["Latin", "CJK"])).toEqual([
      { text: "abc", fontFamily: "Latin" },
      { text: "漢字", fontFamily: "CJK" },
    ]);
  });

  it("switches back when the text does", () => {
    expect(split("a漢b", ["Latin", "CJK"])).toEqual([
      { text: "a", fontFamily: "Latin" },
      { text: "漢", fontFamily: "CJK" },
      { text: "b", fontFamily: "Latin" },
    ]);
  });

  it("keeps adjacent code points of one script in ONE run", () => {
    const runs = split("漢字漢字", ["Latin", "CJK"])!;
    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual({ text: "漢字漢字", fontFamily: "CJK" });
  });

  it("walks the stack in order, taking the FIRST family that has the glyph", () => {
    const three = testMetrics({
      hasGlyph: (cp, family) => (family === "A" ? cp < 0x80 : family === "B" ? cp < 0x100 : true),
    });
    expect(splitByFont("aé漢", "A", ["B", "C"], FontStyle.Normal, three)).toEqual([
      { text: "a", fontFamily: "A" },
      { text: "é", fontFamily: "B" },
      { text: "漢", fontFamily: "C" },
    ]);
  });
});

describe("a code point nobody in the stack has", () => {
  it("stays with the first family, which then shows the missing glyph", () => {
    // What a browser does: the chain ends and the .notdef box appears. Silently dropping the
    // character would be worse - the text would then read differently than it was written.
    const none = testMetrics({ hasGlyph: (cp) => cp < 0x80 });
    // `undefined` IS that answer: nothing was substituted, so the caller keeps its single-family
    // path and the first family draws the missing glyph itself.
    expect(splitByFont("a漢", "Latin", ["AlsoLatin"], FontStyle.Normal, none)).toBeUndefined();
  });
});

describe("astral characters", () => {
  it("are treated as ONE code point, not two halves", () => {
    // The family below holds the whole BMP and nothing above it - the common shape of a real font.
    // Asked about UTF-16 UNITS instead, both surrogates of U+20000 look like BMP characters, the
    // fallback never fires, and the character is drawn from a font that does not have it.
    const bmpOnly = testMetrics({
      hasGlyph: (cp, family) => (family === "BMP" ? cp < 0x10000 : true),
    });
    expect(splitByFont("a\u{20000}b", "BMP", ["Astral"], FontStyle.Normal, bmpOnly)).toEqual([
      { text: "a", fontFamily: "BMP" },
      { text: "\u{20000}", fontFamily: "Astral" },
      { text: "b", fontFamily: "BMP" },
    ]);
  });
});

describe("the edge a review caught", () => {
  it("says 'nothing to substitute' for empty text, not 'no runs at all'", () => {
    // Returning `[]` would hand the caller an empty list to draw - the text would vanish.
    expect(split("", ["Latin", "CJK"])).toBeUndefined();
  });
});

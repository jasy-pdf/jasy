import { describe, it, expect } from "vitest";
import { splitLongWord } from "../../../src/lib/text/word-splitting.ts";
import { wrapStringIntoLines, breakSegmentsIntoLines } from "../../../src/lib/text/line-breaker.ts";
import { runAdvance } from "../../../src/lib/text/advance.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// A word wider than its box used to stay on its line and draw over its neighbour. On an invoice that
// means a §14 UStG mandatory field painted across its own label - not untidy, missing. Two layers now,
// stacked as CSS stacks them: hyphenation first (a valid point, with a hyphen), break-word as the floor
// (anywhere, no hyphen) for the things that have no valid point at all - an e-mail, an IBAN, an
// invoice number.

const metrics = testMetrics();
const FONT = { fontFamily: "Helvetica", fontSize: 12, fontStyle: FontStyle.Normal };
const width = (s: string) => runAdvance(metrics, s, FONT, 0);

/** Stands in for a real pattern-based hyphenator: fixed chunks, so the split points are predictable. */
const chunks = (size: number) => (word: string) =>
  word.match(new RegExp(`.{1,${size}}`, "g")) ?? [word];

const split = (word: string, room: number, options: object) =>
  splitLongWord(word, room, FONT, metrics, 0, options);

describe("when nothing applies", () => {
  it("returns null with neither layer on - the old behaviour, untouched", () => {
    expect(split("abcdefghijkl", 50, {})).toBeNull();
  });

  it("returns null for a word that already fits", () => {
    expect(split("ab", 50, { breakWord: true })).toBeNull();
  });

  it("returns null when not even one character fits, instead of looping forever", () => {
    // A box narrower than a single glyph: splitting cannot help, and taking zero characters per pass
    // would never terminate.
    expect(split("Wort", 1, { breakWord: true })).toBeNull();
  });
});

describe("break-word", () => {
  it("splits into pieces that each fit", () => {
    const pieces = split("abcdefghijkl", 50, { breakWord: true })!;
    expect(pieces).toEqual(["abcd", "efgh", "ijkl"]);
    for (const piece of pieces) expect(width(piece)).toBeLessThanOrEqual(50);
  });

  it("keeps an astral character whole - it iterates code points, not code units", () => {
    const pieces = split("a\u{1F600}\u{1F600}\u{1F600}b", 30, { breakWord: true });
    // Whatever the split, no piece may contain half a surrogate pair.
    for (const piece of pieces ?? []) expect(piece).toBe([...piece].join(""));
  });
});

describe("hyphenation", () => {
  it("splits only at offered points, and draws the hyphen", () => {
    expect(split("aaaabbbbcccc", 60, { hyphenate: chunks(4) })).toEqual(["aaaa-", "bbbb-", "cccc"]);
  });

  it("counts the hyphen against the box, or the line overflows by exactly that hyphen", () => {
    const pieces = split("aaaabbbbcccc", 60, { hyphenate: chunks(4) })!;
    for (const piece of pieces) expect(width(piece)).toBeLessThanOrEqual(60);
  });

  it("gives up when the hyphenator offers nothing, leaving the word whole", () => {
    expect(split("abcdefghijkl", 50, { hyphenate: (w: string) => [w] })).toBeNull();
  });
});

describe("the two layers together", () => {
  it("falls back to break-word for what hyphenation cannot split", () => {
    // An e-mail has no valid hyphenation point anywhere - this is the case the invoice hits.
    const pieces = split("abcdefghijkl", 50, {
      hyphenate: (w: string) => [w],
      breakWord: true,
    })!;
    expect(pieces).toEqual(["abcd", "efgh", "ijkl"]);
  });

  it("prefers a valid point over a blunt one when both could apply", () => {
    const pieces = split("aaaabbbbcccc", 60, { hyphenate: chunks(4), breakWord: true })!;
    expect(pieces[0]).toBe("aaaa-");
  });
});

// The string breaker and the segment breaker have to agree. They did not: the segment path appended the
// first piece to the line it was already filling, although the pieces were measured against the FULL
// box - so a 50pt box got a line 80pt wide, and the line REPORTED 50, which is why nothing complained.
describe("both breakers agree, and report honest widths", () => {
  const MAX = 50;
  const viaString = (text: string) =>
    wrapStringIntoLines(
      text,
      FONT.fontFamily,
      FONT.fontSize,
      FONT.fontStyle,
      MAX,
      metrics,
      undefined,
      undefined,
      0,
      { splitting: { breakWord: true } },
    );
  const viaSpans = (text: string) =>
    breakSegmentsIntoLines(
      [{ content: text }],
      { ...FONT, splitting: { breakWord: true } },
      MAX,
      metrics,
    );

  it.each(["ab abcdefghijkl", "abcdefghijkl", "ab cd", "aaaa bbbbbbbbbbbb cc"])("%j", (text) => {
    const spans = viaSpans(text);
    const lines = spans.map((l) => l.segments.map((s) => s.content).join(""));

    expect(lines).toEqual(viaString(text));
    // No line wider than the box it was broken against...
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(MAX + 0.01);
    // ...and the width each line reports is the width it actually has.
    for (const line of spans)
      expect(line.width).toBeCloseTo(width(line.segments.map((s) => s.content).join("")), 5);
  });
});

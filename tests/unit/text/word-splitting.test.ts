import { describe, it, expect } from "vitest";
import { splitLongWord } from "../../../src/lib/text/word-splitting.ts";
import {
  wrapStringIntoLines,
  breakSegmentsIntoLines,
  breakStringIntoLines,
} from "../../../src/lib/text/line-breaker.ts";
import { runAdvance } from "../../../src/lib/text/advance.ts";
import { FontStyle } from "../../../src/lib/common/font-style.ts";
import { testMetrics } from "../support/metrics.ts";
import { Document, Page, Box, Text, Paragraph, span } from "../../../src/lib/api/index.ts";
import { renderPdf } from "../../../src/lib/api/structure.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";

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

const broken = (word: string, room: number, splitting: object) =>
  breakStringIntoLines(
    word,
    FONT.fontFamily,
    FONT.fontSize,
    FONT.fontStyle,
    room,
    metrics,
    undefined,
    undefined,
    0,
    { splitting },
  );
const split = (word: string, room: number) =>
  splitLongWord(word, room, FONT, metrics, 0)?.map((piece) => piece.text) ?? null;

describe("when nothing applies", () => {
  it("leaves the word whole with neither layer on - the old behaviour, untouched", () => {
    expect(broken("abcdefghijkl", 50, {}).map((l) => l.text)).toEqual(["abcdefghijkl"]);
  });

  it("returns null for a word that already fits", () => {
    expect(split("ab", 50)).toBeNull();
  });

  it("narrower than one character: one per line, as Chrome sets `overflow-wrap` - and it ends", () => {
    expect(split("Wort", 1)).toEqual(["W", "o", "r", "t"]);
    expect(split("W", 1)).toBeNull();
  });
});

describe("break-word", () => {
  it("splits into pieces that each fit", () => {
    const pieces = split("abcdefghijkl", 50)!;
    expect(pieces).toEqual(["abcd", "efgh", "ijkl"]);
    for (const piece of pieces) expect(width(piece)).toBeLessThanOrEqual(50);
  });

  it("keeps an astral character whole - it iterates code points, not code units", () => {
    const pieces = split("a\u{1F600}\u{1F600}\u{1F600}b", 30);
    // Whatever the split, no piece may contain half a surrogate pair.
    for (const piece of pieces ?? []) expect(piece).toBe([...piece].join(""));
  });
});

// Hyphenation is no longer a way to split a word the box cannot hold: its points are break opportunities
// of the breaker itself (hyphenate-like-chrome.test.ts). The layering stays: points first, break-word as
// the floor.

describe("hyphenation", () => {
  it("splits only at offered points, and draws the hyphen it adds", () => {
    const lines = broken("aaaabbbbcccc", 60, { hyphenate: chunks(4) });
    expect(lines.map((l) => l.text)).toEqual(["aaaa-", "bbbb-", "cccc"]);
    // The source holds "aaaa", not "aaaa-": the line says the hyphen was ADDED, and where the next begins.
    expect(lines.map((l) => l.end)).toEqual(["hyphen", "hyphen", "end"]);
    expect(lines.map((l) => l.start)).toEqual([0, 4, 8]);
  });

  it("counts the hyphen against the box, or the line overflows by exactly that hyphen", () => {
    for (const line of broken("aaaabbbbcccc", 60, { hyphenate: chunks(4) }))
      expect(width(line.text)).toBeLessThanOrEqual(60);
  });

  it("leaves the word whole when the hyphenator offers nothing", () => {
    expect(
      broken("abcdefghijkl", 50, { hyphenate: (w: string) => [w] }).map((l) => l.text),
    ).toEqual(["abcdefghijkl"]);
  });
});

describe("the two layers together", () => {
  it("falls back to break-word for what hyphenation cannot split", () => {
    // An e-mail has no valid hyphenation point anywhere - this is the case the invoice hits.
    const lines = broken("abcdefghijkl", 50, { hyphenate: (w: string) => [w], breakWord: true });
    expect(lines.map((l) => l.text)).toEqual(["abcd", "efgh", "ijkl"]);
  });

  it("prefers a valid point over a blunt one when both could apply", () => {
    const lines = broken("aaaabbbbcccc", 60, { hyphenate: chunks(4), breakWord: true });
    expect(lines[0]!.text).toBe("aaaa-");
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

// The breakers were right and the RENDERER still did not split: `breakSegmentsIntoLines` is called from
// three places, and two of them - the measure path and the draw path for styled spans - built their
// `SegmentDefaults` without `splitting`. Same trap the comment beside `letterSpacing` already warns
// about: an option that changes where a line ENDS has to travel with the defaults, or a paragraph is
// measured at one line count and drawn at another. These go through the public API, which is the only
// level that would have caught it.
describe("through the public API", () => {
  const lines = async (el: PDFElement) => {
    const pdf = await renderPdf(Document([Page([el])]), { compress: false } as never);
    const streams = (pdf.match(/stream\n([\s\S]*?)\nendstream/g) ?? []).join("");
    return streams.match(/Td [^\n]*/g) ?? [];
  };

  it("splits inside a styled span, not only in a plain string", async () => {
    const out = await lines(
      Box({ width: 150 }, [
        Paragraph([span("m.schellenberg@berghof-maschinenbau.example")], { breakWord: true }),
      ]),
    );
    expect(out.length).toBeGreaterThan(1);
  });

  it("gives the pieces the full box, not the indented first-line width", async () => {
    // The current line is closed before the pieces are emitted, so they land on lines that never had
    // the indent taken out of them. Measuring against the reduced room made them needlessly short.
    const indented = await lines(
      Box({ width: 150 }, [
        Text("kurz m.schellenberg@berghof-maschinenbau.example", {
          breakWord: true,
          textIndent: 40,
        }),
      ]),
    );
    const plain = await lines(
      Box({ width: 150 }, [
        Text("kurz m.schellenberg@berghof-maschinenbau.example", { breakWord: true }),
      ]),
    );
    // Same number of lines either way: the indent shortens the FIRST line, not the split pieces.
    expect(indented.length).toBe(plain.length);
  });
});

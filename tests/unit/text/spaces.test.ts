import { describe, it, expect } from "vitest";
import {
  breakSegmentsIntoLines,
  breakStringIntoLines,
} from "../../../src/lib/text/line-breaker.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// Spaces count as written - a leading one and every one of a double space. Only the spaces that end a
// line HANG: past the edge, not in the line's width, not drawn. The input is never rewritten.

const width = (text: string, fontSize: number) =>
  [...text].reduce((w, c) => w + (c === " " ? fontSize / 2 : fontSize), 0);
const metrics = testMetrics({
  getStringWidth: (text, _family, fontSize) => width(text, fontSize),
  getCharWidth: (char, fontSize) => width(char, fontSize),
}); // a glyph is 10pt at size 10, a space 5pt

const stringLines = (text: string, max: number) =>
  breakStringIntoLines(text, "Helvetica", 10, FontStyle.Normal, max, metrics).map((l) => l.text);
const spanLines = (parts: string[], max: number) =>
  breakSegmentsIntoLines(
    parts.map((content) => ({ content })),
    { fontFamily: "Helvetica", fontSize: 10, fontStyle: FontStyle.Normal },
    max,
    metrics,
  ).map((l) => ({ text: l.segments.map((s) => s.content).join(""), width: l.width }));

describe("spaces as written", () => {
  it.each([
    [" Hallo", 55],
    ["Hallo  du", 80],
    ["  zwei", 50],
    ["a\n b", 15],
  ])("keeps %j in both paths", (text, w) => {
    const lines = text.split("\n");
    expect(stringLines(text, 1000)).toEqual(lines);
    expect(spanLines([text], 1000).map((l) => l.text)).toEqual(lines);
    expect(Math.max(...spanLines([text], 1000).map((l) => l.width))).toBe(w);
  });

  it("a leading space takes room on the line", () => {
    // " Hallo du" is 80 wide; without its leading space it would fit 78.
    expect(stringLines(" Hallo du", 78)).toEqual([" Hallo", "du"]);
    expect(spanLines([" Hallo du"], 78).map((l) => l.text)).toEqual([" Hallo", "du"]);
  });

  it("a line holding only spaces pushes no blank line before a word that does not fit", () => {
    // " Hallo" is 55 in a 50 box: the word overflows on its own line, after its space.
    expect(stringLines(" Hallo", 50)).toEqual([" Hallo"]);
    expect(spanLines([" Hallo"], 50).map((l) => l.text)).toEqual([" Hallo"]);
    expect(stringLines("a\n Hallo", 50)).toEqual(["a", " Hallo"]);
    expect(stringLines("  Hallo du", 50)).toEqual(["  Hallo", "du"]);
  });

  it("spaces at the end of a line hang: not drawn, not in its width", () => {
    expect(stringLines("Total  ", 1000)).toEqual(["Total"]);
    expect(spanLines(["Total  "], 1000)).toEqual([{ text: "Total", width: 50 }]);
    expect(spanLines(["Total ", " "], 1000)).toEqual([{ text: "Total", width: 50 }]);
  });

  it("the spaces at a wrap stay on the line they end", () => {
    expect(stringLines("aaa  bbb", 45)).toEqual(["aaa", "bbb"]);
    expect(spanLines(["aaa  bbb"], 45)).toEqual([
      { text: "aaa", width: 30 },
      { text: "bbb", width: 30 },
    ]);
  });

  it("only a SPACE hangs - a no-break space is text", () => {
    expect(stringLines(" Hallo ", 1000)).toEqual([" Hallo "]);
  });

  it("a line of spaces is a blank line; a trailing newline adds none", () => {
    expect(stringLines("a\n  \nb", 1000)).toEqual(["a", "", "b"]);
    expect(spanLines(["a\n  \nb"], 1000).map((l) => l.text)).toEqual(["a", "", "b"]);
    expect(stringLines("a\n", 1000)).toEqual(["a"]);
    expect(spanLines(["a\n"], 1000).map((l) => l.text)).toEqual(["a"]);
  });
});

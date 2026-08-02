import { describe, it, expect } from "vitest";
import {
  breakSegmentsIntoLines,
  singleLineWidth,
  wrapStringIntoLines,
} from "../../../src/lib/text/line-breaker.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// The invariant: a box sized by `singleLineWidth` always holds that line. It reads as arithmetic, but
// it is really about the ORDER of the additions - floating point is not associative, and a sum grouped
// differently can be one bit smaller than the one the breaker computes. A footer sized to its own text
// wrapped because of exactly that bit.

const font = { fontFamily: "X", fontSize: 10, fontStyle: FontStyle.Normal };

/** Widths chosen so the sums do NOT come out even in binary - the whole point of the test. */
const metrics = testMetrics({
  getStringWidth: (t) => [...t].reduce((w, c) => w + (c === " " ? 2.502 : 4.407), 0),
  getCharWidth: (c) => (c === " " ? 2.502 : 4.407),
});

const SAMPLES = [
  "ACME Ltd - 1 Example Street",
  "a bb ccc dddd eeeee",
  "one two",
  "single",
  "a b c d e f g h i j k l m n o p",
];

describe("a box sized by singleLineWidth holds its line", () => {
  for (const text of SAMPLES) {
    it(`fits ${JSON.stringify(text)} on one line at exactly its own width`, () => {
      const w = singleLineWidth(text, font, metrics);
      expect(wrapStringIntoLines(text, "X", 10, FontStyle.Normal, w, metrics)).toEqual([text]);
    });
  }

  it("still wraps a hair below that width, so the test is not vacuous", () => {
    const text = SAMPLES[0];
    const w = singleLineWidth(text, font, metrics);
    expect(wrapStringIntoLines(text, "X", 10, FontStyle.Normal, w - 0.001, metrics).length).toBe(2);
  });
});

describe("styled spans get the same treatment", () => {
  // The segment breaker had it twice over: its reported line width carried a trailing space that is
  // never drawn (so a centred or justified span line sat a space off), and it accumulated in a
  // different order from the natural width the box is sized with.
  const spans = (parts: string[]) =>
    parts.map((content) => ({
      content,
      fontFamily: "X",
      fontSize: 10,
      fontStyle: FontStyle.Normal,
    }));
  const defaults = { fontFamily: "X", fontSize: 10, fontStyle: FontStyle.Normal, letterSpacing: 0 };

  it("reports a line's width WITHOUT a trailing space", () => {
    const [line] = breakSegmentsIntoLines(spans(["aa bb"]), defaults, 1000, metrics);
    expect(line.width).toBeCloseTo(singleLineWidth("aa bb", font, metrics), 10);
  });

  it("holds a multi-word span at exactly its own natural width", () => {
    const text = "ACME Ltd - 1 Example Street";
    const w = singleLineWidth(text, font, metrics);
    expect(breakSegmentsIntoLines(spans([text]), defaults, w, metrics)).toHaveLength(1);
  });

  it("counts the joining space when deciding, so a span line cannot overrun its box", () => {
    // Half a space narrower than the text needs. Forgetting the joiner in the fit test lets the last
    // word stay and the line overflows - the same defect the string breaker had.
    const text = "aa bb cc";
    const w = singleLineWidth(text, font, metrics) - 1;
    const lines = breakSegmentsIntoLines(spans([text]), defaults, w, metrics);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.width).toBeLessThanOrEqual(w);
  });

  it("joins two spans with no space between them, as they are drawn", () => {
    // `span("ab") + span("cd")` draws "abcd" - the breaker must not invent a gap.
    const [line] = breakSegmentsIntoLines(spans(["ab", "cd"]), defaults, 1000, metrics);
    expect(line.width).toBeCloseTo(singleLineWidth("abcd", font, metrics), 10);
  });
});

import { describe, it, expect } from "vitest";
import { singleLineWidth, wrapStringIntoLines } from "../../../src/lib/text/line-breaker.ts";
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

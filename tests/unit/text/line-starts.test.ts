import { describe, it, expect } from "vitest";
import {
  breakStringIntoLines,
  wrapStringIntoLines,
  type BrokenLine,
} from "../../../src/lib/text/line-breaker.ts";
import { HYPHEN } from "../../../src/lib/text/word-splitting.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// A broken line knows where it starts in the source and how it ends. A paragraph split across pages
// continues from that position - so it has to be exact for every kind of break.

const metrics = testMetrics(); // every glyph 10pt at size 10, a space is free
const chunks = (size: number) => (word: string) =>
  word.match(new RegExp(`.{1,${size}}`, "g")) ?? [word];

const breakAt = (text: string, width: number, splitting = {}) =>
  breakStringIntoLines(
    text,
    "Helvetica",
    10,
    FontStyle.Normal,
    width,
    metrics,
    undefined,
    undefined,
    0,
    {
      splitting,
    },
  );

/** The line's own characters as the source holds them: without a hyphen the breaker added. */
const sourceOf = (line: BrokenLine) =>
  line.end === "hyphen" ? line.text.slice(0, -HYPHEN.length) : line.text;

const cases: [string, string, number, object][] = [
  ["plain words", "alpha beta gamma delta epsilon zeta eta theta iota kappa", 120, {}],
  ["hard breaks", "first line\nsecond line\n\nafter a blank line", 300, {}],
  ["double spaces", "a  b   c    d", 30, {}],
  ["break-word", "averyveryverylongwordwithoutanyspace and more", 80, { breakWord: true }],
  ["hyphenation", "aaaabbbbccccdddd eeee ffffgggghhhh", 60, { hyphenate: chunks(4) }],
  [
    "everything",
    "one\ntwo threefourfivesix seven\n\neight",
    50,
    { hyphenate: chunks(3), breakWord: true },
  ],
];

describe.each(cases)("line starts: %s", (_name, text, width, splitting) => {
  const lines = breakAt(text, width, splitting);

  it("draws exactly the lines wrapStringIntoLines draws", () => {
    expect(lines.map((l) => l.text)).toEqual(
      wrapStringIntoLines(
        text,
        "Helvetica",
        10,
        FontStyle.Normal,
        width,
        metrics,
        undefined,
        undefined,
        0,
        {
          splitting,
        },
      ),
    );
  });

  it("finds every line in the source at its start", () => {
    for (const line of lines) expect(text.startsWith(sourceOf(line), line.start)).toBe(true);
  });

  it("starts are in order, and what lies between two starts is the earlier line plus separators", () => {
    for (let i = 1; i < lines.length; i++) {
      const between = text.slice(lines[i - 1]!.start, lines[i]!.start);
      expect(lines[i]!.start).toBeGreaterThanOrEqual(lines[i - 1]!.start);
      // Only the line itself and spaces / one newline separate it from the next line.
      expect(between.startsWith(sourceOf(lines[i - 1]!))).toBe(true);
      expect(/^[ \n]*$/.test(between.slice(sourceOf(lines[i - 1]!).length))).toBe(true);
    }
  });
});

describe("how a line ends", () => {
  it("a \\n is hard, a wrap is soft, the last line is the end", () => {
    const ends = breakAt("one two\nthree four five six", 100).map((l) => l.end);
    expect(ends[0]).toBe("hard");
    expect(ends.slice(1, -1).every((e) => e === "soft")).toBe(true);
    expect(ends[ends.length - 1]).toBe("end");
  });

  it("a hyphenated piece ends in a hyphen, a break-word piece is a plain split", () => {
    expect(breakAt("aaaabbbbcccc", 60, { hyphenate: chunks(4) }).map((l) => l.end)).toEqual([
      "hyphen",
      "hyphen",
      "end",
    ]);
    expect(breakAt("abcdefghijkl", 50, { breakWord: true }).map((l) => l.end)).toEqual([
      "split",
      "split",
      "end",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { breakSegmentsIntoLines, wrapStringIntoLines } from "../../../src/lib/text/line-breaker";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { testMetrics } from "../support/metrics.ts";
import { lineBoxForSegmentLine } from "../../../src/lib/text/line-metrics";

// Deterministic metrics: every glyph is 10 wide, spaces are 0. Expected line breaks
// are computed by hand from these, so the test is an oracle, not a snapshot.
const metrics = testMetrics({
  getStringWidth: (text) => text.length * 10,
  getCharWidth: () => 0,
});

const defaults = {
  fontFamily: "Helvetica",
  fontSize: 11,
  fontStyle: FontStyle.Normal,
};

describe("line-breaker", () => {
  it("wraps a plain string greedily by width", () => {
    // words are 20 wide each; maxWidth 50 fits two words per line.
    const lines = wrapStringIntoLines(
      "aa bb cc dd",
      "Helvetica",
      12,
      FontStyle.Normal,
      50,
      metrics,
    );
    expect(lines).toEqual(["aa bb", "cc dd"]);
  });

  it("gives each segment line its own (tallest-on-line) leading", () => {
    // "BIG" (24pt, width 30) then a long 11pt run (each word width 20), maxWidth 60.
    const lines = breakSegmentsIntoLines(
      [
        { content: "BIG", fontSize: 24 },
        { content: "aa bb cc dd ee ff", fontSize: 11 },
      ],
      defaults,
      60,
      metrics,
    );

    // The breaker only decides WHICH segments land on which line; the height comes from those
    // segments (line-metrics.ts). Line 0 carries the 24pt word, the wrapped lines carry only 11pt.
    const sizeOf = (line: (typeof lines)[number]): number =>
      Math.max(...line.segments.map((s) => s.fontSize ?? defaults.fontSize));
    expect(sizeOf(lines[0])).toBe(24);
    expect(lines.slice(1).every((line) => sizeOf(line) === 11)).toBe(true);

    // Each line is sized on its own, NOT on a paragraph-global maximum.
    const box = (line: (typeof lines)[number]): number =>
      lineBoxForSegmentLine(line, defaults, metrics).height;
    expect(box(lines[0])).toBeGreaterThan(box(lines[1]));
    const height = lines.reduce((h, l) => h + box(l), 0);
    expect(height).toBeCloseTo(24 + 11 * (lines.length - 1)); // unitVerticals: 1 em per line
  });

  it("keeps a single over-wide word on one line (no phantom empty leading line)", () => {
    // "wide" is 40 wide, maxWidth 30: it cannot wrap, so it stays on ONE line and overflows. It must
    // not push an empty line in front of it (which would over-count the height by a line).
    const lines = wrapStringIntoLines("wide", "Helvetica", 12, FontStyle.Normal, 30, metrics);
    expect(lines).toEqual(["wide"]);
  });

  it("does the same for an over-wide first word in the segment path", () => {
    const lines = breakSegmentsIntoLines([{ content: "wide" }], defaults, 30, metrics);
    expect(lines).toHaveLength(1);
    expect(lines[0].segments.map((s) => s.content).join("")).toBe("wide");
  });
});

describe("a span boundary is no break opportunity", () => {
  // A style change inside a word (`span("Rech") + span("nung")`) must not break it: the same text cut
  // into spans anywhere breaks exactly where the one string does.
  const text = (lines: ReturnType<typeof breakSegmentsIntoLines>) =>
    lines.map((l) => l.segments.map((s) => s.content).join(""));
  const source = "abc defghijklmnop qr stuvw";
  const whole = text(breakSegmentsIntoLines([{ content: source }], defaults, 100, metrics));

  it("cut once, anywhere: the same lines as one string", () => {
    for (let cut = 1; cut < source.length; cut++) {
      const spans = [{ content: source.slice(0, cut) }, { content: source.slice(cut) }];
      expect(text(breakSegmentsIntoLines(spans, defaults, 100, metrics)), `cut ${cut}`).toEqual(
        whole,
      );
    }
  });

  it("cut twice, anywhere: the same lines as one string", () => {
    for (let a = 1; a < source.length - 1; a++) {
      for (let b = a + 1; b < source.length; b++) {
        const spans = [source.slice(0, a), source.slice(a, b), source.slice(b)].map((content) => ({
          content,
        }));
        expect(text(breakSegmentsIntoLines(spans, defaults, 100, metrics)), `${a}/${b}`).toEqual(
          whole,
        );
      }
    }
  });

  it("a line that starts inside an earlier span says so - a paragraph split across pages resumes there", () => {
    const lines = breakSegmentsIntoLines(
      [{ content: "abc defg" }, { content: "hijklmnop" }],
      defaults,
      100,
      metrics,
    );
    expect(lines[1]!.start).toEqual({ segment: 0, offset: 4 });
  });

  it("a hyphen ending a span is an opportunity - but not before a digit", () => {
    const at = (spans: string[], width: number) =>
      text(
        breakSegmentsIntoLines(
          spans.map((content) => ({ content })),
          defaults,
          width,
          metrics,
        ),
      );
    expect(at(["abc Rech-", "nungen"], 100)).toEqual(["abc Rech-", "nungen"]);
    expect(at(["abc 2026-", "10"], 80)).toEqual(["abc", "2026-10"]);
  });
});

describe("a space that hangs ends the line", () => {
  // Here a space (20) is wider than an `x` (10): after "abcdef" (60) the trailing space does not fit
  // in 75 and hangs, and the next span's "x" would still have fit behind "abcdef" - glued on, its
  // space lost ("abcdefx").
  const wide = testMetrics({
    getStringWidth: (text) => [...text].reduce((w, c) => w + (c === " " ? 20 : 10), 0),
    getCharWidth: () => 0,
  });

  it("the word after it starts the next line", () => {
    const lines = breakSegmentsIntoLines(
      [{ content: "abcdef " }, { content: "x" }],
      defaults,
      75,
      wide,
    );
    expect(lines.map((l) => l.segments.map((s) => s.content).join(""))).toEqual(["abcdef", "x"]);
    expect(lines[1]!.start).toEqual({ segment: 1, offset: 0 });
  });
});

import { describe, it, expect } from "vitest";
import { breakSegmentsIntoLines, wrapStringIntoLines } from "../../../src/lib/text/line-breaker";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics";

// Deterministic metrics: every glyph is 10 wide, spaces are 0. Expected line breaks
// are computed by hand from these, so the test is an oracle, not a snapshot.
const metrics: FontMetrics = {
  getStringWidth: (text) => text.length * 10,
  getCharWidth: () => 0,
};

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

    // Line 0 carries the 24pt word, so its leading is 24; the wrapped 11pt lines are 11.
    expect(lines[0].maxFontSize).toBe(24);
    expect(lines.slice(1).every((line) => line.maxFontSize === 11)).toBe(true);

    // Measured height = sum of per-line leadings (NOT lineCount * globalMax).
    const height = lines.reduce((h, l) => h + l.maxFontSize, 0);
    expect(height).toBe(24 + 11 * (lines.length - 1));
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

import { describe, it, expect } from "vitest";
import { visualRuns, visualRunsOf, needsBidi } from "../../../src/lib/text/bidi.ts";

// UAX #9 decides the ORDER characters appear in, not their shapes. These tests read as what a reader
// would SEE, left to right - which is exactly what `visualRuns` returns.

const HE = "שלום"; // shalom, logical order
const HE_VISUAL = [...HE].reverse().join("");

describe("the fast path", () => {
  it("leaves plain Latin text as one untouched run", () => {
    expect(visualRuns("Invoice 2026")).toEqual([
      { text: "Invoice 2026", logical: "Invoice 2026", rtl: false },
    ]);
  });

  it("spots text that could reorder, and text that cannot", () => {
    expect(needsBidi("Invoice 2026")).toBe(false);
    expect(needsBidi(`total ${HE}`)).toBe(true);
    expect(needsBidi("‏")).toBe(true); // an explicit right-to-left mark
  });
});

describe("a right-to-left run inside left-to-right text", () => {
  it("draws the Hebrew backwards, between the Latin around it", () => {
    const runs = visualRuns(`Hello ${HE} world`);
    expect(runs).toEqual([
      { text: "Hello ", logical: "Hello ", rtl: false },
      // The drawn text is reversed; `logical` gives back what was written, which is what shaping needs.
      { text: HE_VISUAL, logical: HE, rtl: true },
      { text: " world", logical: " world", rtl: false },
    ]);
  });

  it("puts the whole line back together in the same characters", () => {
    const runs = visualRuns(`Hello ${HE} world`);
    expect([...runs.map((r) => r.text).join("")].sort().join("")).toBe(
      [...`Hello ${HE} world`].sort().join(""),
    );
  });
});

describe("a right-to-left base direction", () => {
  it("puts a Latin word at the LEFT, since the line starts on the right", () => {
    const runs = visualRuns(`${HE} abc`, "rtl");
    expect(runs[0]).toEqual({ text: "abc", logical: "abc", rtl: false });
    const last = runs[runs.length - 1];
    expect(last.rtl).toBe(true);
    // The space between them is a NEUTRAL and resolves to the surrounding right-to-left level, so it
    // belongs to this run rather than the Latin one.
    expect(last.text).toBe(` ${HE_VISUAL}`);
  });

  it("keeps a number left to right inside right-to-left text", () => {
    // Digits are weak: they read left to right even when everything around them does not.
    const runs = visualRuns(`${HE} 123 ${HE}`, "rtl");
    expect(runs.some((r) => r.text.includes("123"))).toBe(true);
    expect(runs.every((r) => !r.text.includes("321"))).toBe(true);
  });

  it("mirrors a bracket, so the pair still reads as a pair on screen", () => {
    // Rule L4. Logical: `H ( H )`. Reversing puts the CLOSING bracket leftmost, and mirroring then
    // depicts it as an opening one - so the reader still sees "(...)" and not ")...(". Without this the
    // brackets come out backwards, which is what an empty mirroring map silently produced.
    const line = visualRuns(`${HE} (${HE})`, "rtl")
      .map((r) => r.text)
      .join("");
    expect(line).toBe(`(${HE_VISUAL}) ${HE_VISUAL}`);
  });
});

describe("astral characters survive the reversal", () => {
  it("keeps an emoji whole inside a right-to-left run", () => {
    // A surrogate PAIR is two code units at one level; reversing naively splits it into two broken
    // halves, and the emoji becomes garbage. This is the case that made the pair-rejoin necessary.
    const runs = visualRuns(`${HE}\u{1F600}${HE}`, "rtl");
    const line = runs.map((r) => r.text).join("");
    expect(line).toContain("\u{1F600}");
    expect(line.codePointAt(line.indexOf("\u{1F600}"))).toBe(0x1f600);
  });
});

describe("spans keep their identity through the reordering", () => {
  it("runs the algorithm over the WHOLE line, not each span on its own", () => {
    // Two spans, one Latin one Hebrew. Reordering each in isolation would leave them in source order;
    // running over the joined line is what puts the Hebrew where a reader expects it.
    const runs = visualRunsOf(
      [
        { text: "Total: ", source: "latin" },
        { text: HE, source: "hebrew" },
      ],
      "rtl",
    );
    // Drawn left to right: the Hebrew, then ": " (neutrals, which take the surrounding right-to-left
    // level and so are drawn reversed), then "Total". An Israeli reader starts at the right and gets
    // "Total: shalom" - which is the point.
    expect(runs.map((r) => r.text)).toEqual([HE_VISUAL, " :", "Total"]);
    expect(runs.map((r) => r.source)).toEqual(["hebrew", "latin", "latin"]);
    expect(runs.map((r) => r.rtl)).toEqual([true, true, false]);
  });

  it("splits a run where the span changes, so each keeps its own font", () => {
    const runs = visualRunsOf(
      [
        { text: HE, source: "a" },
        { text: HE, source: "b" },
      ],
      "rtl",
    );
    expect(runs.map((r) => r.source)).toEqual(["b", "a"]);
    expect(runs.every((r) => r.rtl)).toBe(true);
  });

  it("hands the pieces back verbatim when there is nothing to reorder", () => {
    // Empty spans included: the fast path must be a pass-through, or a document that never touches
    // bidi would change its bytes just by this code existing.
    const runs = visualRunsOf(
      [
        { text: "a", source: 1 },
        { text: "", source: 2 },
      ],
      "ltr",
    );
    expect(runs).toEqual([
      { text: "a", logical: "a", rtl: false, source: 1 },
      { text: "", logical: "", rtl: false, source: 2 },
    ]);
  });
});

describe("the logical text a run remembers", () => {
  it("gives back what was written, not what is drawn", () => {
    // SHAPING needs this. A letter's form comes from its neighbours, and reversing swaps them - so
    // shaping the drawn text produces the mirror-image form of every letter (measured on Arabic: a
    // word 8pt too wide). Shape `logical`, then reverse the GLYPHS.
    const [run] = visualRuns(HE, "rtl");
    expect(run.text).toBe(HE_VISUAL);
    expect(run.logical).toBe(HE);
    expect(run.rtl).toBe(true);
  });

  it("is the same string for a left-to-right run", () => {
    const [run] = visualRuns("abc");
    expect(run.logical).toBe(run.text);
    expect(run.rtl).toBe(false);
  });
});

describe("mirrored characters and the logical text", () => {
  it("keeps the author's own bracket in `logical`, not its mirror", () => {
    // The drawn text has the bracket MIRRORED (rule L4). `logical` feeds shaping and, through it,
    // `ToUnicode` - so a mirrored character there would put a bracket in the extracted text that
    // nobody wrote.
    const [run] = visualRuns(`(${HE})`, "rtl");
    expect(run.text).toBe(`(${HE_VISUAL})`); // drawn: closing bracket first, depicted as an opening one
    expect(run.logical).toBe(`(${HE})`); // written: exactly what was passed in
  });
});

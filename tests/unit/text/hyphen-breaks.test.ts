import { describe, it, expect } from "vitest";
import {
  breakSegmentsIntoLines,
  breakStringIntoLines,
  hyphenBreaks,
  hyphenPieces,
} from "../../../src/lib/text/line-breaker.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import type { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// A hyphen inside a word is a break opportunity (UAX #14), as browsers break: after it, never before
// it, never before a digit. Taken only when the whole word does not fit, so text that fits is untouched.

const metrics = testMetrics(); // every glyph 10pt at size 10, a space is free
const lines = (text: string, width: number) =>
  breakStringIntoLines(text, "Helvetica", 10, FontStyle.Normal, width, metrics);
const spanLines = (parts: string[], width: number) =>
  breakSegmentsIntoLines(
    parts.map((content) => ({ content })),
    { fontFamily: "Helvetica", fontSize: 10, fontStyle: FontStyle.Normal },
    width,
    metrics,
  );

describe("where a word may break after a hyphen", () => {
  it.each([
    ["Umsatzsteuer-Identifikationsnummer", [13]],
    ["berghof-maschinenbau", [8]],
    ["LONG-CODE-2", [5]], // not before the digit
    ["2026-10-16", []],
    ["-foo", []], // not after a hyphen that starts the word
    ["a--b", [3]], // not before a hyphen
    ["word-", []],
  ])("%s", (word, expected) => {
    expect(hyphenBreaks(word)).toEqual(expected);
  });

  it("cuts a word into the pieces no line can split", () => {
    expect(hyphenPieces("INV-MRHG2EXG-2026/012-SD")).toEqual(["INV-", "MRHG2EXG-2026/012-", "SD"]);
    expect(hyphenPieces("plain")).toEqual(["plain"]);
  });
});

describe("a word that does not fit breaks after its hyphen", () => {
  it("fills the line with the head and keeps the hyphen there", () => {
    expect(lines("ab cd-efgh", 60).map((l) => l.text)).toEqual(["ab cd-", "efgh"]);
  });

  it("the next line starts in the source right after the hyphen", () => {
    const text = "ab cd-efgh";
    expect(lines(text, 60).map((l) => text.slice(l.start))).toEqual(["ab cd-efgh", "efgh"]);
  });

  it("a word that fits is not broken", () => {
    expect(lines("ab cd-ef", 100).map((l) => l.text)).toEqual(["ab cd-ef"]);
  });

  it("a hyphen before a digit is not a place to break", () => {
    expect(lines("ab CODE-2", 60).map((l) => l.text)).toEqual(["ab", "CODE-2"]);
  });

  it("span text breaks the same way", () => {
    expect(
      spanLines(["ab ", "cd-efgh"], 60).map((l) => l.segments.map((s) => s.content).join("")),
    ).toEqual(["ab cd-", "efgh"]);
  });
});

describe("the narrowest a text can get (min-content) is its widest unbreakable piece", () => {
  it("a hyphen piece, not the whole word", () => {
    const text = new TextElement({ content: "LONG-CODE-2 x", fontSize: 10 });
    const ctx = { metrics, pageConfig: {} } as LayoutContext;
    expect(text.minIntrinsicMain(true, ctx)).toBe(60); // "CODE-2", wider than "LONG-"
  });
});

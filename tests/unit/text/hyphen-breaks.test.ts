import { describe, it, expect } from "vitest";
import {
  breakSegmentsIntoLines,
  breakStringIntoLines,
  hyphenBreaks,
  hyphenPieces,
} from "../../../src/lib/text/line-breaker.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import type { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";
import { drawnTextRuns } from "../support/drawn.ts";
import { runAdvance } from "../../../src/lib/text/advance.ts";
import { coverText } from "../../../src/lib/text/glyph-coverage.ts";
import { Document, Page, Box, Text, renderToBytes } from "../../../src/lib/index.ts";

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

// A soft hyphen (U+00AD, `&shy;`) marks where its author allows a break. It is invisible and has no
// width wherever the line does not break there; where it does, a real hyphen ends the line - as in a
// browser (`hyphens: manual`, the default).
describe("a soft hyphen", () => {
  const S = "­";
  const word = `Ver${S}pflich${S}tung`;

  it("is a break opportunity", () => {
    expect(hyphenBreaks(word)).toEqual([4, 11]);
    expect(hyphenPieces(word)).toEqual(["Ver-", "pflich-", "tung"]);
  });

  it("has no width - measured without it, kerning included", () => {
    const om = new PDFObjectManager(); // real metrics: kerning pairs exist
    om.registerFont("Helvetica");
    const font = { fontFamily: "Helvetica", fontSize: 12, fontStyle: FontStyle.Normal };
    expect(runAdvance(om, `AV${S}AV`, font)).toBe(runAdvance(om, "AVAV", font));
  });

  it("is invisible in a line that does not break at it", () => {
    expect(lines(`ab ${word}`, 300).map((l) => l.text)).toEqual(["ab Verpflichtung"]);
  });

  it("ends the line with a real hyphen where it breaks, and the next line starts after it", () => {
    const text = `ab ${word}`;
    const broken = lines(text, 100);
    expect(broken.map((l) => l.text)).toEqual(["ab Ver-", "pflichtung"]);
    expect(broken.map((l) => l.end)).toEqual(["hyphen", "end"]);
    expect(text.slice(broken[1]!.start)).toBe(`pflich${S}tung`);
  });

  it("span text does the same", () => {
    expect(
      spanLines(["ab ", word], 100).map((l) => l.segments.map((s) => s.content).join("")),
    ).toEqual(["ab Ver-", "pflichtung"]);
  });

  it("is never reported as a missing glyph, even by a font that lacks one", () => {
    const lacking = testMetrics({ hasGlyph: (cp: number) => cp !== 0xad });
    expect(coverText(word, "Test", FontStyle.Normal, lacking).dropped).toEqual([]);
  });

  it("never reaches the page", async () => {
    for (const width of [400, 60]) {
      const runs = await drawnTextRuns(() =>
        renderToBytes(Document([Page([Box({ width }, [Text(`A ${word} here`)])])])),
      );
      expect(runs.some((r) => r.text.includes(S))).toBe(false);
    }
  });
});

// Found in review: the edges of the hyphen rules.
describe("hyphen breaks at their edges", () => {
  const S = "­";
  const contents = (parts: string[], width: number) =>
    spanLines(parts, width).map((l) =>
      l.segments
        .map((s) => s.content)
        .join("")
        .trimEnd(),
    );

  it.each(["Lohn-,", "Lohn-)", "Ein-/Ausgang", "Vor-.", `Lohn${S},`, "(well-known)"])(
    "never before closing punctuation, a slash or a quote: %s",
    (word) => {
      const pieces = hyphenPieces(word);
      for (const p of pieces.slice(1)) expect(p[0]).not.toMatch(/[),./"']/);
    },
  );

  it("a soft hyphen right after a hyphen adds no second one", () => {
    expect(lines(`ab-${S}cdefgh`, 40).map((l) => l.text)).toEqual(["ab-", "cdefgh"]);
  });

  it("a line holding only a soft hyphen draws nothing (span text)", () => {
    for (const line of spanLines([`${S}\nfoo`], 100)) {
      for (const seg of line.segments) expect(seg.content).not.toContain(S);
    }
  });

  it("a break at a span boundary right after a soft hyphen shows the hyphen", () => {
    const broken = spanLines([`ab${S}`, "cdefgh"], 30);
    expect(broken.map((l) => l.segments.map((s) => s.content).join(""))).toEqual(["ab-", "cdefgh"]);
    expect(broken[0]!.end).toBe("hyphen");
    expect(broken[0]!.width).toBe(30); // "ab-": the hyphen is counted in the width it reports
    expect(contents([`ab${S} `, "cdefgh"], 30)).toEqual(["ab", "cdefgh"]); // broke at the space: no hyphen
  });
});

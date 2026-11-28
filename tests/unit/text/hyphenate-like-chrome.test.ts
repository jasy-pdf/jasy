import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { Document, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { Box } from "../../../src/lib/api/layout.ts";
import { Text, span } from "../../../src/lib/api/text.ts";
import { drawnTextRuns } from "../support/drawn.ts";
import { testMetrics } from "../support/metrics.ts";
import { breakSegmentsIntoLines } from "../../../src/lib/text/line-breaker.ts";
import { runAdvance } from "../../../src/lib/text/advance.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { preloadStandardFonts } from "../../../src/lib/utils/afm-parser.ts";
import { FontStyle } from "../../../src/lib/common/font-style.ts";

// `hyphenate` breaks like CSS `hyphens: auto`: its points are break opportunities at the line's end,
// taken only when the word does not fit, and they come from the WHOLE word - across spans too, where a
// point is allowed by the span of the character before it. Every expectation here is Chrome's: the same
// text with the hyphenator's points as `&shy;`, Courier 12pt in a 60pt box (8 characters), read back
// by line (claude-data/out/hyphenate/chrome.html).

const { hyphenateSync } = createRequire(import.meta.url)("hyphen/de") as {
  hyphenateSync: (w: string) => string;
};
const german = (word: string): string[] => hyphenateSync(word).split("­");

const mono = { font: "Courier", size: 12 } as const;
const lines = async (text: ReturnType<typeof Text>, width = 60) => {
  const runs = await drawnTextRuns(() => renderToBytes(Document([Page([Box({ width }, [text])])])));
  const byLine = new Map<number, string>();
  for (const r of runs) byLine.set(Math.round(r.y), (byLine.get(Math.round(r.y)) ?? "") + r.text);
  return [...byLine.values()];
};

describe("hyphenate fills the line, as Chrome does", () => {
  it("breaks at the last point that still fits the line, not on a line of its own", async () => {
    expect(await lines(Text("ab Rechnungsnummer", { ...mono, hyphenate: german }))).toEqual([
      "ab Rech-",
      "nungs-",
      "nummer",
    ]);
  });

  it("takes its points from the whole word, never from what is left of it", async () => {
    // Patterns know words, not the rest of one: asked about "nungsnummer" this one has nothing.
    const wordsOnly = (w: string) => (w === "Rechnungsnummer" ? german(w) : [w]);
    expect(await lines(Text("Rechnungsnummer", { ...mono, hyphenate: wordsOnly }))).toEqual([
      "Rech-",
      "nungs-",
      "nummer",
    ]);
  });

  it("leaves text that fits alone, and never asks the hyphenator about it", async () => {
    let asked = 0;
    const counting = (w: string) => (asked++, german(w));
    expect(await lines(Text("ab Rechnungsnummer", { ...mono, hyphenate: counting }), 200)).toEqual([
      "ab Rechnungsnummer",
    ]);
    expect(asked).toBe(0);
  });

  it("needs room for the hyphen too", async () => {
    // At 8.5 characters "abc Rech" fits, "abc Rech-" does not: the word moves down whole.
    expect(await lines(Text("abc Rechnungsnummer", { ...mono, hyphenate: german }), 61.2)).toEqual([
      "abc",
      "Rech-",
      "nungs-",
      "nummer",
    ]);
  });
});

describe("hyphenate on a word that runs across spans", () => {
  it("sees the whole word", async () => {
    expect(
      await lines(Text([span("ab Rech"), span("nungsnummer")], { ...mono, hyphenate: german })),
    ).toEqual(["ab Rech-", "nungs-", "nummer"]);
  });

  it("a point is allowed by the span of the character before it: set on the first", async () => {
    expect(
      await lines(Text([span("ab Rech", { hyphenate: german }), span("nungsnummer")], mono)),
    ).toEqual(["ab Rech-", "nungsnummer"]);
  });

  it("a point is allowed by the span of the character before it: set on the second", async () => {
    expect(
      await lines(Text([span("ab Rech"), span("nungsnummer", { hyphenate: german })], mono)),
    ).toEqual(["ab", "Rechnungs-", "nummer"]);
  });

  it("a point inside an earlier span splits that span", async () => {
    expect(
      await lines(Text([span("ab Rechnu"), span("ngsnummer")], { ...mono, hyphenate: german })),
    ).toEqual(["ab Rech-", "nungs-", "nummer"]);
  });
});

describe("the edges", () => {
  it("finds a point inside an earlier span that already fit the line", async () => {
    expect(
      await lines(Text([span("Rechnu"), span("ngsnummer")], { ...mono, hyphenate: german })),
    ).toEqual(["Rech-", "nungs-", "nummer"]);
  });

  it("does not break at a span's end when the hyphen would not fit there", async () => {
    // 8.5 characters: "abc Rech" fits, "abc Rech-" does not, so the line ends at the space.
    expect(
      await lines(
        Text([span("abc Rech"), span("nungsnummer")], { ...mono, hyphenate: german }),
        61.2,
      ),
    ).toEqual(["abc", "Rech-", "nungs-", "nummer"]);
  });

  it("draws the hyphen in the style of the character before it", async () => {
    const runs = await drawnTextRuns(() =>
      renderToBytes(
        Document([
          Page([
            Box({ width: 60 }, [
              Text([span("ab Rech", { bold: true }), span("nungsnummer")], {
                ...mono,
                hyphenate: german,
              }),
            ]),
          ]),
        ]),
      ),
    );
    const bold = runs.find((r) => r.text.endsWith("-"))!;
    expect(bold.text).toBe("ab Rech-");
    expect(bold.fontStyle).toBe("bold");
  });

  it("a first piece too wide even for an empty line overflows with its hyphen, and the rest goes on", async () => {
    expect(await lines(Text("Rechnungsnummer", { ...mono, hyphenate: german }), 30)).toEqual([
      "Rech-",
      "nungs-",
      "num-",
      "mer",
    ]);
  });

  it("a soft hyphen at a point is one break, with one hyphen", async () => {
    expect(await lines(Text("ab Rech\u00ADnungsnummer", { ...mono, hyphenate: german }))).toEqual([
      "ab Rech-",
      "nungs-",
      "nummer",
    ]);
  });
});

describe("the narrowest a hyphenated text gets (min-content)", () => {
  it("is its widest piece with the hyphen, not one character", () => {
    const ctx = {
      metrics: testMetrics(),
      pageConfig: { width: 595, height: 842, margin: 0 },
    } as never;
    const floor = Text("Rechnungsnummer", { ...mono, hyphenate: german }).minIntrinsicMain(
      true,
      ctx,
    );
    // "nungs-" and "nummer", six glyphs - every test glyph as wide as the font size.
    expect(floor).toBe(6 * 12);
  });
});

describe("what review found", () => {
  const unit = { fontFamily: "Helvetica", fontSize: 1, fontStyle: FontStyle.Normal };
  const broken = (segments: { content: string }[], width: number, splitting: object) =>
    breakSegmentsIntoLines(segments, { ...unit, splitting }, width, testMetrics()).map((l) =>
      l.segments.map((s) => s.content).join(""),
    );
  const ctx = {
    metrics: testMetrics(),
    pageConfig: { width: 595, height: 842, margin: 0 },
  } as never;

  it("min-content takes its points from the whole word across spans", () => {
    const wordsOnly = (w: string) => (w === "Rechnungsnummer" ? german(w) : [w]);
    const floor = Text([span("Rech"), span("nungsnummer")], {
      ...mono,
      hyphenate: wordsOnly,
    }).minIntrinsicMain(true, ctx);
    expect(floor).toBe(6 * 12);
  });

  it("min-content counts the hyphen at a point on a span's end", () => {
    // "Rech-nungs|-num-mer" across "Rechnungs" + "nummer": the widest piece is "nungs-", whose hyphen
    // stands at the span's end.
    const wordsOnly = (w: string) => (w === "Rechnungsnummer" ? german(w) : [w]);
    const floor = Text([span("Rechnungs"), span("nummer")], {
      ...mono,
      hyphenate: wordsOnly,
    }).minIntrinsicMain(true, ctx);
    expect(floor).toBe(6 * 12);
  });

  it("min-content adds no second hyphen after a literal one", () => {
    const parts = (w: string) => (w === "ab-cd" ? ["ab-", "cd"] : [w]);
    expect(Text("ab-cd", { ...mono, hyphenate: parts }).minIntrinsicMain(true, ctx)).toBe(3 * 12);
  });

  it("finds a point in the LAST word of an earlier span", () => {
    const parts = (w: string) => (w === "abcdefgh" ? ["abc", "defgh"] : [w]);
    expect(broken([{ content: "Hi abcd" }, { content: "efgh" }], 8, { hyphenate: parts })).toEqual([
      "Hi abc-",
      "defgh",
    ]);
  });

  it("a justified line may squeeze its spaces to keep a hyphen at a span's end", () => {
    // Spaces as wide as letters here: "Hi abc-" is 7, its one space may give up half of itself.
    const spaced = testMetrics({
      getStringWidth: (text, _family, fontSize) => [...text].length * fontSize,
      getCharWidth: (_char, fontSize) => fontSize,
    });
    const parts = (w: string) => (w === "abcdefgh" ? ["abc", "defgh"] : [w]);
    const lines = breakSegmentsIntoLines(
      [{ content: "Hi abc" }, { content: "defgh" }],
      { ...unit, shrink: 0.5, splitting: { hyphenate: parts } },
      6.5,
      spaced,
    ).map((l) => l.segments.map((s) => s.content).join(""));
    expect(lines).toEqual(["Hi abc-", "defgh"]);
  });

  it("with breakWord, a piece too wide for an empty line is split anywhere, with no hyphen", () => {
    const parts = (w: string) => (w === "abcdefgh" ? ["abcdef", "gh"] : [w]);
    expect(broken([{ content: "abcdefgh" }], 3, { hyphenate: parts, breakWord: true })).toEqual([
      "abc",
      "def",
      "gh",
    ]);
  });

  it("measures the hyphen it adds with its kern pair, as it is drawn", async () => {
    // Helvetica kerns "T-" by -140/1000: a line ending in "T-" is narrower than "T" plus "-".
    await preloadStandardFonts();
    const om = new PDFObjectManager();
    om.registerFont("Helvetica", FontStyle.Normal);
    om.setKerning(true);
    const font = { fontFamily: "Helvetica", fontSize: 20, fontStyle: FontStyle.Normal };
    const drawn = (t: string) => runAdvance(om, t, font, 0);
    expect(drawn("aaT-")).toBeLessThan(drawn("aaT") + drawn("-") - 1); // the pair is really there
    for (const splitting of [
      {},
      { hyphenate: (w: string) => (w === "aaTbbbbbbbb" ? ["aaT", "bbbbbbbb"] : [w]) },
    ]) {
      const segments = [
        { content: "hyphenate" in splitting ? "aaT" : "aaT\u00AD" },
        { content: "bbbbbbbb" },
      ];
      const [first] = breakSegmentsIntoLines(
        segments,
        { ...font, splitting },
        drawn("aaT-") + 1,
        om,
      );
      expect(first!.segments.map((s) => s.content).join("")).toBe("aaT-");
      expect(first!.width).toBeCloseTo(drawn("aaT-"), 9);
    }
    // The first piece too wide even for an empty line: it overflows with its hyphen, measured as drawn.
    const points = (w: string) => (w === "aaTbb" ? ["aaT", "bb"] : [w]);
    const [forced] = breakSegmentsIntoLines(
      [{ content: "aaTbb" }],
      { ...font, splitting: { hyphenate: points } },
      drawn("a"),
      om,
    );
    expect(forced!.segments.map((s) => s.content).join("")).toBe("aaT-");
    expect(forced!.width).toBeCloseTo(drawn("aaT-"), 9);
  });
});

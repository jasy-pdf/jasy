import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { Document, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { Box } from "../../../src/lib/api/layout.ts";
import { Text, span } from "../../../src/lib/api/text.ts";
import { drawnTextRuns } from "../support/drawn.ts";
import { testMetrics } from "../support/metrics.ts";

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

// A span takes every inline text style: set on the span it applies to that run, unset it inherits the
// Text's. What belongs to the whole paragraph (`direction`, `textIndent`, `align`) is not a span option.
import { describe, it, expect } from "vitest";
import { Document, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { Box } from "../../../src/lib/api/layout.ts";
import { Text, span } from "../../../src/lib/api/text.ts";
import { drawnTextRuns } from "../support/drawn.ts";
import { testMetrics } from "../support/metrics.ts";

const drawn = async (text: ReturnType<typeof Text>) =>
  (await drawnTextRuns(() => renderToBytes(Document([Page([text])])))).map((r) => r.text).join("");

describe("textTransform on a span", () => {
  it("recases just that run", async () => {
    expect(await drawn(Text([span("abc", { textTransform: "uppercase" }), span(" def")]))).toBe(
      "ABC def",
    );
  });

  it("unset, a span inherits the Text's; set, it wins", async () => {
    const text = Text([span("abc"), span(" def", { textTransform: "none" })], {
      textTransform: "uppercase",
    });
    expect(await drawn(text)).toBe("ABC def");
  });

  it("capitalize runs through the spans: a word split over two spans is one word", async () => {
    const text = Text([span("hel", { textTransform: "capitalize" }), span("lo world")], {
      textTransform: "capitalize",
    });
    expect(await drawn(text)).toBe("Hello World");
  });
});

describe("skipInk on a span", () => {
  // A standard-14 font has no outlines to step around, so asking for skipInk with one is a named
  // error - which makes it visible whether the span's own setting reached the drawing.
  const render = (text: ReturnType<typeof Text>) => renderToBytes(Document([Page([text])]));

  it("set on a span, it applies to that run", async () => {
    const text = Text([span("Hxgp", { underline: true, skipInk: true })], { size: 40 });
    await expect(render(text)).rejects.toThrow(/skipInk needs an embedded font/);
  });

  it("a span can switch the Text's off", async () => {
    const text = Text([span("Hxgp", { skipInk: false })], {
      size: 40,
      underline: true,
      skipInk: true,
    });
    await expect(render(text)).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe("breakWord and hyphenate on a span", () => {
  // Courier at 10pt is 6pt a character: a 48pt box holds exactly 8.
  const lines = async (text: ReturnType<typeof Text>) =>
    (await drawnTextRuns(() => renderToBytes(Document([Page([Box({ width: 48 }, [text])])])))).map(
      (r) => r.text,
    );
  const mono = { font: "Courier", size: 10 } as const;

  it("breakWord set on a span splits that span's word", async () => {
    expect(await lines(Text([span("aaaaaaaaaa", { breakWord: true })], mono))).toEqual([
      "aaaaaaaa",
      "aa",
    ]);
  });

  it("a span can switch the Text's breakWord off - its word overflows whole", async () => {
    expect(
      await lines(Text([span("aaaaaaaaaa", { breakWord: false })], { ...mono, breakWord: true })),
    ).toEqual(["aaaaaaaaaa"]);
  });

  it("hyphenate set on a span splits that span's word at the hyphenator's points", async () => {
    const hyphenate = (word: string) => [word.slice(0, 5), word.slice(5)];
    expect(await lines(Text([span("abcdefghij", { hyphenate })], mono))).toEqual([
      "abcde-",
      "fghij",
    ]);
  });

  it("a span that may split lowers the min-content floor to a character, as the Text-wide setting does", () => {
    const ctx = {
      metrics: testMetrics(),
      pageConfig: { width: 595, height: 842, margin: 0 },
    } as never;
    const word = "Verpflichtungserklaerung";
    const whole = Text([span(word)], { size: 12 }).minIntrinsicMain(true, ctx);
    const splittable = Text([span(word, { breakWord: true })], { size: 12 }).minIntrinsicMain(
      true,
      ctx,
    );
    expect(splittable).toBeLessThan(whole / 5);
  });
});

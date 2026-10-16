import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Box,
  Paragraph,
  Anchor,
  Text,
  span,
  renderToBytes,
} from "../../../src/lib/index.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import type { LayoutContext, PDFElement } from "../../../src/lib/elements/pdf-element.ts";
import type { Fragmentable } from "../../../src/lib/layout/fragmentation.ts";
import type { IRNode } from "../../../src/lib/ir/display-list.ts";
import { testMetrics } from "../support/metrics.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { drawnNodes } from "../support/drawn.ts";

// A piece of an element split across pages is the same element on the next page: it keeps every
// property the original had - its text options, its width rules, its place in the flex line.

const ctx = { metrics: testMetrics(), pageConfig: {} } as LayoutContext;
const split = (el: PDFElement, maxHeight: number, width: number) =>
  (el as PDFElement & Fragmentable).fragment(maxHeight, width, ctx);

const LINE = "A paragraph long enough to take several lines on a small page.";
const long = (n: number) => Array.from({ length: n }, (_, i) => `(${i + 1}) ${LINE}`).join(" ");
const render = (content: PDFElement[]) =>
  drawnNodes(() =>
    renderToBytes(Document([Page({ size: "A6", margin: 20 }, [Column({}, content)])]), {
      onOverflow: "error",
    }),
  );
const rects = (page: IRNode[]) => page.flatMap((n) => (n.type === "rect" && n.stroke ? [n] : []));

describe("a piece of a split Text keeps its text options", () => {
  it("breakWord, hyphenate and ligatures come along", () => {
    const hyphenate = (w: string) => [w];
    const text = new TextElement({
      content: long(20),
      fontSize: 10,
      breakWord: true,
      hyphenate,
      ligatures: false,
    });
    text.measure(BoxConstraints.loose(200, Infinity), ctx);
    const { fitted, remainder } = split(text, 40, 200);
    for (const piece of [fitted, remainder] as TextElement[]) {
      const props = piece.getProps();
      expect(props.breakWord).toBe(true);
      expect(props.hyphenate).toBe(hyphenate);
      expect(props.ligatures).toBe(false);
    }
  });

  it("a piece keeps the original's place in its flex line", () => {
    const text = new TextElement({ content: long(20), fontSize: 10 })
      .withAlignSelf("end")
      .withOrder(3)
      .withFlexShrink(0);
    text.measure(BoxConstraints.loose(200, Infinity), ctx);
    const { remainder } = split(text, 40, 200);
    expect(remainder!.alignSelf).toBe("end");
    expect(remainder!.order).toBe(3);
    expect(remainder!.flexShrink).toBe(0);
    expect(remainder!.structId).toBe(text.structId);
  });
});

describe("a split Box or Column keeps its width rules", () => {
  it("a Box with maxWidth splits (it used to be moved whole and cut off) and is that wide on every page", async () => {
    const pages = await render([
      Box({ maxWidth: 150, border: "#1450aa", padding: 4 }, [Paragraph(long(20), { size: 9 })]),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(rects(page).map((r) => r.width)).toEqual([150]);
  });

  it("a piece of a Column with maxWidth is still that wide", () => {
    const column = Column({ maxWidth: 150 }, [Paragraph(long(30), { size: 9 })]);
    const { fitted, remainder } = split(column, 120, 250);
    for (const piece of [fitted!, remainder!]) {
      expect(piece.measure(BoxConstraints.loose(250, Infinity), ctx).width).toBe(150);
    }
  });

  it("a Column with maxWidth is packed at that width: nothing runs past the page", async () => {
    const items = Array.from({ length: 24 }, (_, i) =>
      Paragraph(`Item ${i + 1}: a paragraph long enough to wrap inside 150pt.`, { size: 9 }),
    );
    const pages = await render([Column({ maxWidth: 150 }, items)]);
    expect(pages.length).toBeGreaterThan(1);
    const A6_HEIGHT = 419.53;
    for (const page of pages) {
      for (const n of page) if (n.type === "text") expect(n.y).toBeLessThan(A6_HEIGHT - 20);
    }
  });

  it("alignSelf on a split Box in a centred Column holds on every page", async () => {
    const pages = await render([
      Column({ align: "center" }, [
        Box({ width: 150, border: "#1450aa", padding: 4, alignSelf: "start" }, [
          Paragraph(long(20), { size: 9 }),
        ]),
      ]),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(rects(page).map((r) => r.x)).toEqual([20]);
  });

  it("a keepTogether Box too tall for one page splits and keeps its alignSelf on every page", async () => {
    const pages = await render([
      Column({ align: "center" }, [
        Box({ width: 150, border: "#1450aa", padding: 4, alignSelf: "start", keepTogether: true }, [
          Paragraph(long(20), { size: 9 }),
        ]),
      ]),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(rects(page).map((r) => r.x)).toEqual([20]);
  });
});

describe("a wrapper dropped from a continued piece leaves its place in the flow", () => {
  it("the bare continuation of an Anchor keeps the Anchor's alignSelf", async () => {
    const pages = await render([
      Column({ align: "center" }, [
        Anchor(
          { name: "a" },
          Box({ width: 150, border: "#1450aa", padding: 4 }, [Paragraph(long(20), { size: 9 })]),
        ).withAlignSelf("start"),
        Text("after"),
      ]),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) expect(rects(page).map((r) => r.x)).toEqual([20]);
  });
});

// A paragraph split across pages continues from where its next line starts in the SOURCE text, so
// nothing about how a line ended is lost at the page break.
describe("a paragraph split across pages keeps how its lines end", () => {
  const om = new PDFObjectManager();
  om.registerFont("Helvetica");
  const RIGHT_EDGE = 20 + 257.64; // A6, 20pt margins
  /** The right end of the last word drawn on a page, and that line's y. */
  const lastLineEnd = (page: IRNode[]) => {
    const runs = page.flatMap((n) => (n.type === "text" ? [n] : []));
    const y = Math.max(...runs.map((r) => r.y));
    const last = runs.filter((r) => r.y === y).sort((a, b) => b.x - a.x)[0]!;
    return last.x + om.getStringWidth(last.text, "Helvetica", last.fontSize, last.fontStyle);
  };

  it("hard line breaks survive the split: one entry per line on every page", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => `Entry ${i + 1}`);
    const pages = await render([Text(entries.join("\n"), { size: 9 })]);
    expect(pages.length).toBeGreaterThan(1);
    const drawn = pages.flatMap((p) => p.flatMap((n) => (n.type === "text" ? [n.text] : [])));
    expect(drawn).toEqual(entries);
  });

  it("justified: the last line on a page is stretched, the paragraph's own last line is not", async () => {
    const pages = await render([
      Paragraph(
        Array.from(
          { length: 40 },
          (_, i) =>
            `In justified text (${i + 1}) a short word next to a considerably longer one shows the gaps.`,
        ).join(" "),
        { size: 9, align: "justify" },
      ),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    expect(lastLineEnd(pages[0]!)).toBeCloseTo(RIGHT_EDGE, 1);
    expect(lastLineEnd(pages[pages.length - 1]!)).toBeLessThan(RIGHT_EDGE - 5);
  });

  it("justified: the line before a hard break is not stretched", async () => {
    const pages = await render([
      Paragraph(
        "Short line\nand a second paragraph long enough to wrap across the full width of the page, twice over.",
        {
          size: 9,
          align: "justify",
        },
      ),
    ]);
    const runs = pages[0]!.flatMap((n) => (n.type === "text" ? [n.text] : []));
    // Natural spacing draws the line as ONE run; a stretched line would be drawn word by word.
    expect(runs).toContain("Short line");
  });

  it("a word hyphenated at the page break is not glued back together on the next line (todo 12)", async () => {
    const simple = (w: string) => (w.length > 8 ? [w.slice(0, 4), w.slice(4)] : [w]);
    const pages = await render([
      ...Array.from({ length: 24 }, () => Text("filler line", { size: 12 })),
      Box({ width: 70 }, [
        Text("Rechnungsnummernvergabe und Leistungszeitraumbestimmung", { hyphenate: simple }),
      ]),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    const drawn = pages.flatMap((p) => p.flatMap((n) => (n.type === "text" ? [n.text] : [])));
    // Every piece of a hyphenated word ends its own line: no "Rech- nung-" on one line.
    expect(drawn.filter((t) => /- \S/.test(t))).toEqual([]);
  });

  it("capitalize: the half of a word continued on the next page is not capitalised again", async () => {
    const words = Array.from({ length: 30 }, () => "abcdefghijklmnopqrstuvw").join(" ");
    const pages = await render([
      Text("one line first, so the page break falls inside a word", { size: 12 }),
      Box({ width: 60 }, [Text(words, { size: 12, breakWord: true, textTransform: "capitalize" })]),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    const drawn = pages.flatMap((p) => p.flatMap((n) => (n.type === "text" ? [n.text] : [])));
    // Only a word's first piece starts with a capital.
    expect(drawn.filter((t) => /^[A-Z]/.test(t) && !t.startsWith("Abc"))).toEqual([]);
  });
});

describe("a span paragraph split across pages keeps how its lines end", () => {
  it("hard line breaks inside spans survive the split", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => `Entry ${i + 1}`);
    const pages = await render([
      Text(
        [
          span(entries.slice(0, 20).join("\n") + "\n"),
          span(entries.slice(20).join("\n"), { bold: true }),
        ],
        { size: 9 },
      ),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    // (A span ending in `\n` leaves an empty run on the next line; it draws nothing - see todo.)
    const drawn = pages.flatMap((p) =>
      p.flatMap((n) => (n.type === "text" && n.text ? [n.text] : [])),
    );
    expect(drawn).toEqual(entries);
  });

  it("justified span text: the last line on a page is stretched, the paragraph's own last is not", async () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica");
    const end = (page: IRNode[]) => {
      const runs = page.flatMap((n) => (n.type === "text" && n.text ? [n] : []));
      const y = Math.max(...runs.map((r) => r.y));
      const last = runs.filter((r) => r.y === y).sort((a, b) => b.x - a.x)[0]!;
      return last.x + om.getStringWidth(last.text, "Helvetica", last.fontSize, last.fontStyle);
    };
    const sentence = (i: number) =>
      `In justified text (${i}) a short word next to a considerably longer one shows the gaps. `;
    const pages = await render([
      Paragraph(
        Array.from({ length: 40 }, (_, i) =>
          span(sentence(i + 1), i % 2 ? { color: "#1450aa" } : {}),
        ),
        { size: 9, align: "justify" },
      ),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    expect(end(pages[0]!)).toBeCloseTo(20 + 257.64, 1);
    expect(end(pages[pages.length - 1]!)).toBeLessThan(20 + 257.64 - 5);
  });

  it("hyphenated span text splits where it is drawn: nothing past the page, no glued pieces", async () => {
    const simple = (w: string) => (w.length > 8 ? [w.slice(0, 4), w.slice(4)] : [w]);
    const words = Array.from({ length: 30 }, () => "Rechnungsnummernvergabe").join(" ");
    const pages = await render([
      Box({ width: 70 }, [Text([span(words)], { hyphenate: simple, size: 10 })]),
    ]);
    expect(pages.length).toBeGreaterThan(1);
    const A6_HEIGHT = 419.53;
    for (const page of pages)
      for (const n of page) if (n.type === "text") expect(n.y).toBeLessThan(A6_HEIGHT - 20);
    const drawn = pages.flatMap((p) => p.flatMap((n) => (n.type === "text" ? [n.text] : [])));
    expect(drawn.filter((t) => /- \S/.test(t))).toEqual([]);
  });
});

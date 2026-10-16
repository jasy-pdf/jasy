import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Box,
  Paragraph,
  Anchor,
  Text,
  renderToBytes,
} from "../../../src/lib/index.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import type { LayoutContext, PDFElement } from "../../../src/lib/elements/pdf-element.ts";
import type { Fragmentable } from "../../../src/lib/layout/fragmentation.ts";
import type { IRNode } from "../../../src/lib/ir/display-list.ts";
import { testMetrics } from "../support/metrics.ts";
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

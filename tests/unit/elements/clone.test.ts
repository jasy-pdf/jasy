// `clone()` copies an element and everything it lays out, as it was built, so one element can be placed
// twice. What it only points to (an image's pixels, a callback) stays shared; the copy tags as its own.
import { describe, it, expect } from "vitest";
import { Document, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { Box, Column, Row } from "../../../src/lib/api/layout.ts";
import { Canvas, Image } from "../../../src/lib/api/content.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { Table } from "../../../src/lib/api/table.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";
import { drawnTextRuns } from "../support/drawn.ts";
import { testMetrics } from "../support/metrics.ts";

const ctx = { metrics: testMetrics(), pageConfig: { width: 595, height: 842, margin: 0 } } as never;
const tree = (el: PDFElement): PDFElement[] => [el, ...el.layoutChildren().flatMap(tree)];

describe("clone", () => {
  it("copies the whole subtree: no instance is shared", () => {
    const original = Column([Box({ padding: 4 }, [Text("a")]), Row([Text("b"), Text("c")])]);
    const copy = original.clone();
    const mine = new Set(tree(original));
    expect(tree(copy).length).toBe(mine.size);
    expect(tree(copy).some((el) => mine.has(el))).toBe(false);
  });

  it("laying the copy out leaves the original where it was", () => {
    const original = Column([Text("a"), Text("b")]);
    original.calculateLayout(BoxConstraints.loose(200, 200), { x: 10, y: 20 }, ctx);
    original.clone().calculateLayout(BoxConstraints.loose(100, 200), { x: 50, y: 60 }, ctx);
    expect(original.getProps()).toMatchObject({ x: 10, y: 20, width: 200 });
  });

  it("can be drawn on the same page as the original", async () => {
    const label = Text("twice");
    const runs = await drawnTextRuns(() =>
      renderToBytes(Document([Page([Column([label, label.clone()])])])),
    );
    expect(runs.filter((r) => r.text === "twice").length).toBe(2);
  });

  it("a table copies too, element cells and all, before or after it was laid out", async () => {
    const table = Table({ columns: ["auto", "1fr"], header: [Text("H")] }, [[Text("a"), "b"]]);
    const before = table.clone();
    const twice = await drawnTextRuns(() =>
      renderToBytes(Document([Page([Column([table, before])])])),
    );
    expect(twice.filter((r) => r.text === "a").length).toBe(2);
    const after = await drawnTextRuns(() =>
      renderToBytes(Document([Page([Column([table, table.clone()])])])),
    );
    expect(after.filter((r) => r.text === "H").length).toBe(2);
  });

  it("shares what the element only points to, and tags as an element of its own", () => {
    const paint = () => {};
    const canvas = Canvas({ width: 10, height: 10 }, paint);
    const image = Image(new Uint8Array([1, 2, 3]));
    expect(canvas.clone().getProps().paint).toBe(paint);
    expect(image.clone().getProps().image).toBe(image.getProps().image);
    expect(canvas.clone().structId).not.toBe(canvas.structId);
  });
});

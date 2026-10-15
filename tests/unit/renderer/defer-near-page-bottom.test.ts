import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Box,
  Padding,
  Text,
  Table,
  renderToBytes,
} from "../../../src/lib/index.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";

// Content that does not fit in what is left of a page moves to the next page - whatever it is
// nested in. Pushed down one point at a time, every container passes through the strip where its
// FIRST child no longer fits; that strip is where it used to throw "Layout overflow" (default
// policy) although a fresh page had plenty of room. A fixed document lands in that strip only by
// chance, so this walks through it.

const A4_BODY = 842 - 2 * 48;

const lines = (n: number) =>
  Column(
    { gap: 1 },
    Array.from({ length: n }, (_, i) => Text(`line ${i + 1}`, { size: 9 })),
  );

const cases: Record<string, () => PDFElement> = {
  "a Column of Text": () => Column({ gap: 2 }, [Text("first"), Text("second")]),
  "a Table": () =>
    Table({ columns: ["1fr", 80] }, [
      ["Row 1", "4.52"],
      ["Row 2", "1.00"],
    ]),
  "a Table with a repeating header": () =>
    Table({ columns: ["1fr", 80], header: ["Item", "Amount"] }, [
      ["Row 1", "4.52"],
      ["Row 2", "1.00"],
    ]),
  "a Table whose row is ten lines tall": () =>
    Table({ columns: ["1fr", 80], header: ["Item", "Amount"] }, [
      [lines(10), "4.52"],
      [lines(10), "1.00"],
    ]),
  "a bordered Box": () => Box({ border: "black" }, [Text("first"), Text("second")]),
  "a padded Column": () => Padding(4, Column({ gap: 2 }, [Text("first"), Text("second")])),
};

const pushedDown = (push: number, content: PDFElement) =>
  Document([Page({ size: "A4", margin: 48 }, [Box({ height: push }, []), content])]);

describe("content that does not fit the rest of the page moves on instead of throwing", () => {
  for (const [name, make] of Object.entries(cases)) {
    it(name, async () => {
      const failing: number[] = [];
      for (let push = A4_BODY - 140; push <= A4_BODY - 1; push++) {
        try {
          await renderToBytes(pushedDown(push, make()));
        } catch {
          failing.push(push);
        }
      }
      expect(failing).toEqual([]);
    });
  }
});

describe("what fits on no page at all is still reported", () => {
  it("a table row taller than a whole page throws under the default policy", async () => {
    // 80 lines is ~911pt: it moves to a fresh page and still does not fit there.
    const tooTall = Table({ columns: ["1fr", 80] }, [[lines(80), "4.52"]]);
    await expect(renderToBytes(pushedDown(10, tooTall))).rejects.toThrow(/Layout overflow/);
  });
});

// A Box of fixed height whose content fits (or that is empty) used to report "fits whole" without
// checking its OWN height, so it was drawn past the page end - over the footer, silently.
const RED = "1.000 0.000 0.000 RG";
const uncompressed = async (doc: Parameters<typeof renderToBytes>[0]) =>
  new TextDecoder("latin1").decode(await renderToBytes(doc, { compress: false }));
// 1-based content stream (= physical page) that draws `marker`.
const pageOf = (pdf: string, marker: string): number =>
  [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)].findIndex((m) => m[1].includes(marker)) + 1;

describe("a Box of fixed height that does not fit the rest of the page moves on whole", () => {
  it.each([
    ["empty", () => Box({ height: 200, border: "red" })],
    ["with short content", () => Box({ height: 200, border: "red" }, [Text("short")])],
  ])("%s", async (_what, box) => {
    expect(pageOf(await uncompressed(pushedDown(600, box())), RED)).toBe(2);
    // The control: with room left it stays where it is.
    expect(pageOf(await uncompressed(pushedDown(300, box())), RED)).toBe(1);
  });

  it("a fixed Box taller than a whole page is reported, not drawn past the page", async () => {
    const tooTall = Box({ height: A4_BODY + 100, border: "red" });
    await expect(renderToBytes(pushedDown(10, tooTall))).rejects.toThrow(/Layout overflow/);
  });
});

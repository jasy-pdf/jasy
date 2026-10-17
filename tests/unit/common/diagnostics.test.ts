import { describe, it, expect, vi, afterEach } from "vitest";
import {
  Box,
  Column,
  Document,
  Page,
  PageBreak,
  Row,
  Table,
  Text,
  keepTogether,
  mm,
  renderToBytes,
  type Diagnostic,
} from "../../../src/lib/api/index.ts";

// One channel for everything the engine has to say about a document it rendered anyway. Each finding
// carries a stable code, the element by the name an author writes, and its first text - so an
// application, or an agent that cannot see the page, can find the place.

const collect = async (doc: ReturnType<typeof Document>, options = {}) => {
  const seen: Diagnostic[] = [];
  await renderToBytes(doc, { ...options, onDiagnostic: (d) => seen.push(d) });
  return seen;
};

afterEach(() => vi.restoreAllMocks());

describe("onDiagnostic - each finding, once", () => {
  it("a PageBreak inside a Row", async () => {
    const seen = await collect(Document([Page([Row([Text("left"), PageBreak(), Text("right")])])]));
    expect(seen).toEqual([
      expect.objectContaining({ code: "page-break-ignored", element: "PageBreak" }),
    ]);
  });

  it("a breakBefore in a Row cell, and in a table row - named by the cell's first text", async () => {
    const inRow = await collect(
      Document([
        Page([Row([Text("a"), Box({ breakBefore: true }, [Text("Gesamtbetrag netto")])])]),
      ]),
    );
    expect(inRow).toEqual([
      expect.objectContaining({
        code: "break-ignored",
        element: "Box",
        text: "Gesamtbetrag netto",
      }),
    ]);
    const inTable = await collect(
      Document([
        Page([
          Table({ columns: ["1fr", "1fr"] }, [
            ["Pos. 1", Box({ breakAfter: true }, [Text("Summe")])],
            ["Pos. 2", "x"],
          ]),
        ]),
      ]),
    );
    expect(inTable).toEqual([expect.objectContaining({ code: "break-ignored", text: "Summe" })]);
  });

  it("a keepTogether that holds a forced break", async () => {
    const seen = await collect(
      Document([Page([keepTogether([Text("one"), PageBreak(), Text("two")])])]),
    );
    expect(seen).toEqual([
      expect.objectContaining({
        code: "keep-together-split",
        element: "KeepTogether",
        text: "one",
      }),
    ]);
  });

  it("clipped overflow, with its page; the default policy still throws", async () => {
    const tooTall = () =>
      Document([
        Page({ size: mm(50, 40), margin: 4 }, [
          Text("fits"),
          PageBreak(),
          Text("X", { size: 300 }),
        ]),
      ]);
    const seen = await collect(tooTall(), { onOverflow: "warn" });
    expect(seen).toEqual([
      expect.objectContaining({ code: "overflow-clipped", element: "Text", text: "X", page: 2 }),
    ]);
    await expect(collect(tooTall())).rejects.toThrow(/overflow/i);
  });

  it("characters no font can draw, per Text - and onMissingGlyphs still hears of them", async () => {
    let dropped: string[] = [];
    const seen = await collect(Document([Page([Text("ok"), Text("Schnee ☃ heute")])]), {
      onMissingGlyphs: (c: string[]) => (dropped = c),
    });
    expect(seen).toEqual([
      expect.objectContaining({ code: "missing-glyphs", element: "Text", text: "Schnee ☃ heute" }),
    ]);
    expect(dropped).toEqual(["☃"]);
  });

  it("a clean document says nothing", async () => {
    expect(await collect(Document([Page([Column([Text("a"), Row([Text("b")])])])]))).toEqual([]);
  });
});

describe("without a handler - as before", () => {
  it("what warned before still warns, once; what was silent stays silent", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderToBytes(Document([Page([Row([PageBreak()]), Text("Schnee ☃")])]));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/PageBreak had no effect/);
  });
});

// A Flow pours its content through the Regions of a template, region after region, page after page.
// Every Region boundary is a real break boundary; on its last page the Flow shrinks to what it used.
import { describe, it, expect, vi } from "vitest";
import { Document, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { Box, Column, Expanded, Row, Spacer, keepTogether } from "../../../src/lib/api/layout.ts";
import { Canvas } from "../../../src/lib/api/content.ts";
import { PageBuilder } from "../../../src/lib/api/page-builder.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { Table } from "../../../src/lib/api/table.ts";
import {
  ColumnBreak,
  Flow,
  FlowRegionsEmptyError,
  FlowUnboundedError,
  FlowWithoutRegionError,
  Region,
  RegionInPageBuilderError,
  RegionOutsideFlowError,
  RegionReusedError,
  SplitView,
} from "../../../src/lib/api/flow.ts";
import type { Diagnostic } from "../../../src/lib/common/diagnostics.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";
import { drawnPages } from "../support/drawn.ts";

// A 300pt page with a 20pt margin: a 260 x 260 body. Two columns of 120 with a 20 gap: x 20 and 160.
// Courier 10pt lines are 10.55pt (its bbox), so a column holds 24 of them.
const LEFT = 20;
const RIGHT = 160;
const mono = { font: "Courier", size: 10 } as const;
const lines = (from: number, to: number, prefix = "L") =>
  Array.from({ length: to - from }, (_, i) => Text(`${prefix}${from + i}`, mono));
const twoColumns = () => Row({ gap: 20 }, [Expanded(Region()), Expanded(Region())]);

const render = (body: PDFElement[], onDiagnostic?: (d: Diagnostic) => void) =>
  drawnPages(() =>
    renderToBytes(Document([Page({ size: { width: 300, height: 300 }, margin: 20 }, body)]), {
      onDiagnostic,
    }),
  );
const find = (page: { text: string }[], text: string) =>
  page.find((r) => r.text === text) as {
    x: number;
    y: number;
  };

describe("Flow", () => {
  it("fills its Regions in order, then continues on the next page", async () => {
    const pages = await render([Flow({ template: twoColumns }, lines(0, 60))]);
    expect(pages.length).toBe(2);
    const order = pages.flat().map((r) => r.text);
    expect(order).toEqual(lines(0, 60).map((_, i) => `L${i}`));
    // Region 1, then region 2, then region 1 of the next page.
    expect(find(pages[0]!, "L0").x).toBe(LEFT);
    expect(find(pages[0]!, "L23").x).toBe(LEFT);
    expect(find(pages[0]!, "L24").x).toBe(RIGHT);
    expect(find(pages[0]!, "L24").y).toBe(find(pages[0]!, "L0").y);
    expect(find(pages[1]!, "L48").x).toBe(LEFT);
  });

  it("between other content, it continues on the next page and what follows comes after it", async () => {
    const pages = await render([
      Text("before", mono),
      Flow({ template: twoColumns }, lines(0, 60)),
      Text("after", mono),
    ]);
    const order = pages.flat().map((r) => r.text);
    expect(order).toEqual(["before", ...lines(0, 60).map((_, i) => `L${i}`), "after"]);
  });

  it("is drawn as it was paginated, even where a page re-shares its space (a Spacer)", async () => {
    const oneColumn = () => Row([Expanded(Region())]);
    const pages = await render([
      Flow({ template: oneColumn }, lines(0, 15)),
      Spacer(),
      Text("foot", mono),
    ]);
    expect(pages.length).toBe(1);
    expect(pages[0]!.map((r) => r.text)).toEqual([...lines(0, 15).map((_, i) => `L${i}`), "foot"]);
  });

  it("builds its template per page: `index` counts the Flow's own pages", async () => {
    const template = ({ index }: { index: number }) =>
      Column([...(index === 0 ? [Text("Title", mono)] : []), Expanded(twoColumns())]);
    const pages = await render([Flow({ template }, lines(0, 60))]);
    expect(pages.map((p) => p.filter((r) => r.text === "Title").length)).toEqual([1, 0]);
  });

  it("on its last page shrinks to what it used, so what follows comes right after", async () => {
    const pages = await render([Flow({ template: twoColumns }, lines(0, 5)), Text("after", mono)]);
    expect(pages.length).toBe(1);
    const last = find(pages[0]!, "L4");
    const after = find(pages[0]!, "after");
    expect(after.x).toBe(LEFT);
    expect(after.y - last.y).toBeCloseTo(10.55, 1);
  });

  it("a Region with a height of its own keeps it on the last page", async () => {
    const template = () => Row([Region({ width: 100, height: 100 })]);
    const pages = await render([Flow({ template }, lines(0, 2)), Text("after", mono)]);
    expect(find(pages[0]!, "after").y).toBeGreaterThanOrEqual(LEFT + 100);
  });

  it("every Region boundary is a break boundary: keepTogether moves to the next Region whole", async () => {
    const kept = Column({ keepTogether: true }, lines(0, 3, "K"));
    const pages = await render([Flow({ template: twoColumns }, [...lines(0, 23), kept])]);
    expect(find(pages[0]!, "K0").x).toBe(RIGHT);
    expect(find(pages[0]!, "K0").y).toBe(find(pages[0]!, "L0").y);
  });

  it("a table repeats its header in the next Region", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`r${i}`]);
    const pages = await render([
      Flow({ template: twoColumns }, [Table({ columns: ["1fr"], header: ["H"] }, rows)]),
    ]);
    const headers = pages[0]!.filter((r) => r.text === "H");
    expect(headers.length).toBe(2);
    expect(headers[0]!.x).toBeLessThan(RIGHT);
    expect(headers[1]!.x).toBeGreaterThanOrEqual(RIGHT);
  });

  it("a table header given as an element repeats too - each Region gets a copy", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`r${i}`]);
    const header = [Text("Item", { ...mono, bold: true })];
    const pages = await render([
      Flow({ template: twoColumns }, [Table({ columns: ["1fr"], header }, rows)]),
    ]);
    expect(pages[0]!.filter((r) => r.text === "Item").length).toBe(2);
  });

  it("in a box with a height it fills that box; the rest is cut, as onOverflow says", async () => {
    const boxed = () =>
      Document([
        Page({ size: { width: 300, height: 300 }, margin: 20 }, [
          Box({ height: 60 }, [Flow({ template: twoColumns }, lines(0, 40))]),
        ]),
      ]);
    const clipped = async (onOverflow: "warn" | "ignore") => {
      const seen: Diagnostic[] = [];
      const pages = await drawnPages(() =>
        renderToBytes(boxed(), { onOverflow, onDiagnostic: (d) => seen.push(d) }),
      );
      expect(pages.length).toBe(1);
      const drawn = pages[0]!.map((r) => r.text);
      expect(drawn.length).toBeGreaterThan(5);
      expect(drawn.length).toBeLessThan(40);
      expect(seen.filter((d) => d.code === "overflow-clipped").length).toBe(1);
    };
    await clipped("warn");
    await clipped("ignore");
    await expect(renderToBytes(boxed(), { onOverflow: "error" })).rejects.toThrow(
      /a Flow has more/,
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await renderToBytes(boxed(), { onOverflow: "ignore" });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("content taller than every Region is placed, clipped, and the Flow still advances", async () => {
    const seen: Diagnostic[] = [];
    const tall = Canvas({ height: 400 }, () => {});
    const pages = await drawnPages(() =>
      renderToBytes(
        Document([
          Page({ size: { width: 300, height: 300 }, margin: 20 }, [
            Flow({ template: twoColumns }, [tall, ...lines(0, 3)]),
          ]),
        ]),
        { onOverflow: "warn", onDiagnostic: (d) => seen.push(d) },
      ),
    );
    expect(pages.flat().map((r) => r.text)).toEqual(["L0", "L1", "L2"]);
    expect(seen.some((d) => d.code === "overflow-clipped")).toBe(true);
  });
});

describe("Flow - wrapped", () => {
  const all = (n: number) => [...lines(0, n).map((_, i) => `L${i}`), "after"];
  const texts = (pages: { text: string }[][]) => pages.flat().map((r) => r.text);

  it("in a Box (border, padding, background) it continues on the next page, in the box", async () => {
    for (const opts of [{}, { border: 1 }, { padding: 10 }, { bg: "#eee" }]) {
      const pages = await render([
        Box(opts, [Flow({ template: twoColumns }, lines(0, 60))]),
        Text("after", mono),
      ]);
      expect(texts(pages)).toEqual(all(60));
      expect(pages.length).toBe(2);
    }
  });

  it("in an Expanded it continues on the next page", async () => {
    const pages = await render([
      Expanded(Flow({ template: twoColumns }, lines(0, 60))),
      Text("after", mono),
    ]);
    expect(texts(pages)).toEqual(all(60));
  });

  it("keepTogether keeps it on one page: moved on whole when it would end on the next", async () => {
    const pages = await render([
      ...lines(0, 20, "P"),
      keepTogether([Flow({ template: twoColumns }, lines(0, 20))]),
      Text("after", mono),
    ]);
    // Page 1 has room for 4 lines a column below the P lines, so the Flow would end on page 2.
    expect(pages.length).toBe(2);
    expect(texts([pages[1]!])).toEqual(all(20));
  });

  it("keepTogether on a Flow longer than a page splits it, as any too-tall group", async () => {
    const pages = await render([
      keepTogether([Flow({ template: twoColumns }, lines(0, 60))]),
      Text("after", mono),
    ]);
    expect(texts(pages)).toEqual(all(60));
  });

  it("a Box split into a wider Region is sized there, not by the narrow one it came from", async () => {
    const seen: Diagnostic[] = [];
    const words = Array.from({ length: 120 }, (_, i) => `w${i}`).join(" ");
    const template = () => Row({ gap: 20 }, [Region({ width: 60 }), Expanded(Region())]);
    const pages = await render(
      [Flow({ template }, [Box({ border: 1 }, [Text(words, mono)])])],
      (d) => seen.push(d),
    );
    expect(seen).toEqual([]);
    expect(pages.length).toBe(1);
    expect(pages[0]!.find((r) => r.text.includes("w119"))!.x).toBeGreaterThan(LEFT + 60);
  });

  it("in a table cell (a Row whose height is its content's) it has no height to take", async () => {
    await expect(
      render([
        Table({ columns: ["1fr", "1fr"] }, [
          [Text("a"), Flow({ template: twoColumns }, lines(0, 5))],
        ]),
      ]),
    ).rejects.toThrow(FlowUnboundedError);
  });

  it("in a wrapping Row it takes what the lines before it leave of the height", async () => {
    const seen: Diagnostic[] = [];
    const pages = await drawnPages(() =>
      renderToBytes(
        Document([
          Page({ size: { width: 300, height: 300 }, margin: 20 }, [
            Row({ height: 100, wrap: true }, [
              Box({ width: 260, height: 40 }),
              Box({ width: 260 }, [Flow({ template: () => Region() }, lines(0, 12))]),
            ]),
            Text("after", mono),
          ]),
        ]),
        { onOverflow: "warn", onDiagnostic: (d) => seen.push(d) },
      ),
    );
    const after = find(pages[0]!, "after").y;
    const flowed = pages[0]!.filter((r) => r.text.startsWith("L"));
    expect(flowed.length).toBeGreaterThan(2);
    expect(flowed.length).toBeLessThan(12);
    expect(flowed.every((r) => r.y < after)).toBe(true);
    expect(seen.map((d) => d.code)).toEqual(["overflow-clipped"]);
  });

  it("in a Row inside a wrapping Row it needs that inner Row to have a height", async () => {
    const nested = (wrap: boolean, height?: number) =>
      render([
        Row({ height: 50, wrap }, [
          Expanded(Row({ height }, [Expanded(Flow({ template: twoColumns }, lines(0, 8)))])),
        ]),
        Text("after", mono),
      ]);
    // A wrapped line is as tall as its content, so the inner Row is 0 tall - and the error says so.
    await expect(nested(true)).rejects.toThrow(/In a wrapping Row a line is only as tall/);
    for (const pages of [await nested(false), await nested(true, 50)]) {
      expect(find(pages[0]!, "L4").x).toBe(RIGHT);
    }
  });

  it("a Region with no room says nothing about wrapping Rows", async () => {
    await expect(
      render([Flow({ template: () => Region({ width: 0 }) }, lines(0, 3))]),
    ).rejects.toThrow(FlowRegionsEmptyError);
    await expect(
      render([Flow({ template: () => Region({ width: 0 }) }, lines(0, 3))]),
    ).rejects.not.toThrow(/wrapping Row/);
  });

  it("in a Row with a height it takes that height - a wrapping Row too", async () => {
    for (const wrap of [false, true]) {
      const pages = await render([
        Row({ height: 50, wrap }, [Expanded(Flow({ template: twoColumns }, lines(0, 8)))]),
        Text("after", mono),
      ]);
      expect(texts(pages)).toEqual(all(8));
      expect(find(pages[0]!, "L4").x).toBe(RIGHT);
    }
  });
});

describe("Flow - templates", () => {
  const texts = (pages: { text: string }[][]) => pages.flat().map((r) => r.text);
  const all = (n: number) => [...lines(0, n).map((_, i) => `L${i}`), "after"];
  const run = (template: () => PDFElement, n: number) =>
    render([Flow({ template }, lines(0, n)), Text("after", mono)]);

  it("Regions in a bordered, padded Box fill it; a rule between them shrinks with them", async () => {
    const boxed = () => Box({ border: "black", padding: 10 }, [twoColumns()]);
    const ruled = () =>
      Row({ gap: 6 }, [Expanded(Region()), Box({ width: 1, bg: "black" }, []), Expanded(Region())]);
    for (const template of [boxed, ruled]) {
      const pages = await run(template, 60);
      expect(texts(pages)).toEqual(all(60));
      expect(pages.length).toBe(2);
    }
  });

  it("a title above the Regions needs no Expanded: the Row of Regions takes the rest", async () => {
    const pages = await run(() => Column([Text("Title", mono), twoColumns()]), 30);
    expect(find(pages[0]!, "L0").y).toBeGreaterThan(find(pages[0]!, "Title").y);
    expect(pages[0]!.some((r) => r.x === RIGHT)).toBe(true);
  });

  it("a % Region is a share of the Flow: on the last page the Flow is as tall as that share needs", async () => {
    for (const template of [
      () => Region({ height: "50%" }),
      () => Row([Expanded(Region({ height: "50%" })), Expanded(Region())]),
    ]) {
      const pages = await run(template, 10);
      expect(pages.length).toBe(1);
      expect(texts(pages)).toEqual(all(10));
      expect(find(pages[0]!, "after").y).toBeGreaterThan(find(pages[0]!, "L9").y);
    }
  });

  it("a Region with a width of its own keeps it beside one that takes the rest", async () => {
    const sidebar = () => Row({ gap: 10 }, [Region({ width: 60 }), Expanded(Region())]);
    const pages = await run(sidebar, 40);
    expect(texts(pages)).toEqual(all(40));
    expect(find(pages[0]!, "L24").x).toBe(LEFT + 60 + 10);
  });

  it("what the template has below a % Region stays below its content", async () => {
    const footed = () => Column([Region({ height: "50%" }), Text("foot", mono)]);
    const pages = await run(footed, 10);
    expect(find(pages[0]!, "foot").y).toBeGreaterThan(find(pages[0]!, "L9").y);
  });

  it("stacked Regions: on the last page each still holds what it was given", async () => {
    const stacked = () => Column({ gap: 10 }, [Expanded(Region()), Expanded(Region())]);
    const pages = await run(stacked, 30);
    expect(texts(pages)).toEqual(all(30));
    const last = pages.at(-1)!;
    const after = find(last, "after");
    for (const r of last) if (r.text !== "after") expect(r.y).toBeLessThan(after.y);
  });

  it("two Flows in Expanded on one page: the second starts below the first", async () => {
    const one = () => Row([Expanded(Region())]);
    const pages = await render([
      Expanded(Flow({ template: one }, lines(0, 16, "A"))),
      Expanded(Flow({ template: one }, lines(0, 2, "B"))),
    ]);
    expect(find(pages[0]!, "B0").y).toBeGreaterThan(find(pages[0]!, "A15").y);
  });
});

describe("ColumnBreak", () => {
  it("continues in the next Region", async () => {
    const pages = await render([
      Flow({ template: twoColumns }, [...lines(0, 3), ColumnBreak(), ...lines(3, 5)]),
    ]);
    expect(find(pages[0]!, "L3").x).toBe(RIGHT);
    expect(find(pages[0]!, "L3").y).toBe(find(pages[0]!, "L0").y);
  });

  it("from the last Region, continues in the next page's first; nested in the content too", async () => {
    const pages = await render([
      Flow({ template: twoColumns }, [
        ...lines(0, 2),
        ColumnBreak(),
        Column([...lines(2, 4), ColumnBreak(), ...lines(4, 6)]),
      ]),
    ]);
    expect(pages.length).toBe(2);
    expect(find(pages[0]!, "L2").x).toBe(RIGHT);
    expect(find(pages[1]!, "L4").x).toBe(LEFT);
  });

  it("several in a row skip several Regions", async () => {
    const pages = await render([
      Flow({ template: twoColumns }, [
        ...lines(0, 2),
        ColumnBreak(),
        ColumnBreak(),
        ...lines(2, 4),
      ]),
    ]);
    expect(pages.length).toBe(2);
    expect(find(pages[1]!, "L2").x).toBe(LEFT);
  });

  it("in a Flow inside a Flow, it belongs to the innermost one", async () => {
    const halves = () => Row([Expanded(Region()), Expanded(Region())]);
    const inner = Flow({ template: halves }, [Text("I0", mono), ColumnBreak(), Text("I1", mono)]);
    const pages = await render([Flow({ template: twoColumns }, [inner, Text("after", mono)])]);
    expect(pages.length).toBe(1);
    // The inner Flow's second half (120 / 2), and the outer Flow is still in its first Region.
    expect(find(pages[0]!, "I1").x).toBe(LEFT + 60);
    expect(find(pages[0]!, "I1").y).toBe(find(pages[0]!, "I0").y);
    expect(find(pages[0]!, "after").x).toBe(LEFT);
  });

  it("outside a Flow it has no effect, and says so", async () => {
    const seen: Diagnostic[] = [];
    const pages = await render([Column([...lines(0, 2), ColumnBreak(), ...lines(2, 4)])], (d) =>
      seen.push(d),
    );
    expect(pages.length).toBe(1);
    expect(find(pages[0]!, "L2").y - find(pages[0]!, "L1").y).toBeCloseTo(10.55, 1);
    expect(seen.filter((d) => d.code === "column-break-ignored").length).toBe(1);
  });
});

describe("SplitView", () => {
  it("is newspaper columns: equally wide, filled in order, then the next page", async () => {
    // Three columns of (260 - 2 x 10) / 3 = 80.
    const pages = await render([SplitView({ columns: 3, colGap: 10 }, lines(0, 80))]);
    expect(pages.length).toBe(2);
    expect(pages.flat().map((r) => r.text)).toEqual(lines(0, 80).map((_, i) => `L${i}`));
    expect([0, 1, 2].map((c) => find(pages[0]!, `L${c * 24}`).x)).toEqual([20, 110, 200]);
    expect(find(pages[1]!, "L72").x).toBe(LEFT);
  });

  it("`colGap` spaces the columns, `rowGap` the content", async () => {
    const pages = await render([SplitView({ colGap: 20, rowGap: 5 }, lines(0, 30))]);
    expect(find(pages[0]!, "L1").y - find(pages[0]!, "L0").y).toBeCloseTo(15.55, 1);
    expect(find(pages[0]!, "L0").x).toBe(LEFT);
    expect(pages[0]!.some((r) => r.x === RIGHT)).toBe(true);
  });

  it("`gap` spaces both", async () => {
    const pages = await render([SplitView({ gap: 20 }, lines(0, 30))]);
    expect(find(pages[0]!, "L1").y - find(pages[0]!, "L0").y).toBeCloseTo(30.55, 1);
    expect(pages[0]!.some((r) => r.x === RIGHT)).toBe(true);
  });

  it("balances its last page: columns of about equal height, what follows right below", async () => {
    const pages = await render([SplitView({ colGap: 20 }, lines(0, 30)), Text("after", mono)]);
    expect(pages.length).toBe(1);
    expect(find(pages[0]!, "L14").x).toBe(LEFT);
    expect(find(pages[0]!, "L15").x).toBe(RIGHT);
    expect(find(pages[0]!, "L15").y).toBe(find(pages[0]!, "L0").y);
    expect(find(pages[0]!, "after").y - find(pages[0]!, "L14").y).toBeCloseTo(10.55, 1);
  });

  it("balances only the last page: the pages before it fill in turn", async () => {
    const pages = await render([SplitView({ colGap: 20 }, lines(0, 60))]);
    expect(pages.length).toBe(2);
    expect(find(pages[0]!, "L24").x).toBe(RIGHT);
    expect(find(pages[1]!, "L53").x).toBe(LEFT);
    expect(find(pages[1]!, "L54").x).toBe(RIGHT);
  });

  it("balances around a ColumnBreak, and keeps a keepTogether whole", async () => {
    // Three columns of 80 at x 20, 110, 200; after the break 20 lines share the last two.
    const pages = await render([
      SplitView({ columns: 3, colGap: 10 }, [
        ...lines(0, 4),
        ColumnBreak(),
        ...lines(4, 12),
        keepTogether(lines(12, 16, "K")),
        ...lines(16, 24),
      ]),
      Text("after", mono),
    ]);
    expect(find(pages[0]!, "L4").x).toBe(110);
    expect(find(pages[0]!, "L4").y).toBe(find(pages[0]!, "L0").y);
    expect(find(pages[0]!, "K12").x).toBe(find(pages[0]!, "K15").x);
    expect(find(pages[0]!, "L23").x).toBe(200);
    const bottom = Math.max(...pages[0]!.filter((r) => r.text !== "after").map((r) => r.y));
    expect(find(pages[0]!, "after").y - bottom).toBeCloseTo(10.55, 1);
  });

  it("draws every line once when the content needs fewer columns than there are", async () => {
    const pages = await render([SplitView({ columns: 3, colGap: 10 }, lines(0, 4))]);
    expect(pages.flat().map((r) => r.text)).toEqual(["L0", "L1", "L2", "L3"]);
    expect(find(pages[0]!, "L2").x).toBe(110);
  });

  it("balances no lower than a keepTogether needs: the group stays whole", async () => {
    const pages = await render([
      SplitView({ colGap: 20 }, [
        ...lines(0, 2),
        keepTogether(lines(2, 16, "K")),
        ...lines(16, 20),
      ]),
    ]);
    expect(find(pages[0]!, "K2").x).toBe(find(pages[0]!, "K15").x);
  });

  it("balances no lower than a block that cannot break - nothing clipped, nothing reported", async () => {
    const seen: Diagnostic[] = [];
    const pages = await render(
      [
        SplitView({ colGap: 20 }, [Canvas({ height: 100 }, () => {}), ...lines(0, 4)]),
        Text("after", mono),
      ],
      (d) => seen.push(d),
    );
    expect(seen).toEqual([]);
    expect(find(pages[0]!, "after").y).toBeGreaterThan(20 + 100);
  });

  it("`balance: false` fills the columns in turn, as a Flow does by default", async () => {
    for (const body of [
      SplitView({ colGap: 20, balance: false }, lines(0, 30)),
      Flow({ template: twoColumns }, lines(0, 30)),
    ]) {
      const pages = await render([body]);
      expect(find(pages[0]!, "L23").x).toBe(LEFT);
      expect(find(pages[0]!, "L24").x).toBe(RIGHT);
    }
  });

  it("a Flow balances when asked", async () => {
    const pages = await render([Flow({ template: twoColumns, balance: true }, lines(0, 30))]);
    expect(find(pages[0]!, "L15").x).toBe(RIGHT);
  });

  it("one column has nothing to balance: drawn as a Flow with one Region", async () => {
    const bytes = (body: PDFElement) =>
      renderToBytes(Document([Page({ size: { width: 300, height: 300 }, margin: 20 }, [body])]));
    const split = await bytes(SplitView({ columns: 1 }, lines(0, 30)));
    const flow = await bytes(Flow({ template: () => Row([Expanded(Region())]) }, lines(0, 30)));
    expect(Buffer.from(split).equals(Buffer.from(flow))).toBe(true);
  });

  it("a column count that is not a whole number of 1 or more is refused", () => {
    expect(() => SplitView({ columns: 0 }, [])).toThrow(/columns 0/);
    expect(() => SplitView({ columns: 1.5 }, [])).toThrow(/columns 1.5/);
    expect(() => SplitView({ columns: "2" as never }, [])).toThrow(/columns "2"/);
  });

  it("a gap that is not a number of points, 0 or more, is refused", () => {
    expect(() => SplitView({ gap: -10 }, [])).toThrow(/gap -10/);
    expect(() => SplitView({ rowGap: NaN }, [])).toThrow(/rowGap NaN/);
    expect(() => SplitView({ colGap: Infinity }, [])).toThrow(/colGap Infinity/);
  });
});

describe("Flow - named errors", () => {
  it("a template without a Region", async () => {
    await expect(render([Flow({ template: () => Column([]) }, lines(0, 3))])).rejects.toThrow(
      FlowWithoutRegionError,
    );
  });

  it("a Region in the content, or outside any Flow", async () => {
    await expect(render([Flow({ template: twoColumns }, [Region()])])).rejects.toThrow(
      RegionOutsideFlowError,
    );
    await expect(render([Region()])).rejects.toThrow(RegionOutsideFlowError);
  });

  it("a Region in a PageBuilder (which builds again when drawn); the template has the page already", async () => {
    const built = () => PageBuilder(() => twoColumns());
    await expect(render([Flow({ template: built }, lines(0, 30))])).rejects.toThrow(
      RegionInPageBuilderError,
    );
  });

  it("a Region made while the template is laid out - in a Table cell - is found", async () => {
    const table = () =>
      Table({ columns: ["1fr", "1fr"] }, [[Region({ height: 200 }), Region({ height: 200 })]]);
    const pages = await render([Flow({ template: table }, lines(0, 30))]);
    expect(pages.flat().map((r) => r.text)).toEqual(lines(0, 30).map((_, i) => `L${i}`));
  });

  it("a template that hands out the same Region twice", async () => {
    const tree = twoColumns();
    await expect(render([Flow({ template: () => tree }, lines(0, 100))])).rejects.toThrow(
      RegionReusedError,
    );
  });

  it("a template that leaves its Regions no room - unless the next page has it", async () => {
    const crowded = () =>
      Row(
        { gap: 20 },
        Array.from({ length: 14 }, () => Expanded(Region())),
      );
    await expect(render([Flow({ template: crowded }, lines(0, 3))])).rejects.toThrow(
      FlowRegionsEmptyError,
    );
    // A template whose own parts are taller than the space has no room either.
    const tallFoot = () => Column([Region(), Canvas({ height: 300 }, () => {})]);
    await expect(render([Flow({ template: tallFoot }, lines(0, 3))])).rejects.toThrow(
      FlowRegionsEmptyError,
    );
    // Below other content there is only no room YET: it moves on to a fresh page.
    const tall = ({ index }: { index: number }) =>
      Column([...(index === 0 ? [Canvas({ height: 200 }, () => {})] : []), twoColumns()]);
    const pages = await render([...lines(0, 10, "P"), Flow({ template: tall }, lines(0, 3))]);
    expect(pages.flat().map((r) => r.text)).toEqual([
      ...lines(0, 10, "P").map((_, i) => `P${i}`),
      ...lines(0, 3).map((_, i) => `L${i}`),
    ]);
  });

  it("a Flow with no height to take (a Row without a height)", async () => {
    await expect(render([Row([Flow({ template: twoColumns }, lines(0, 3))])])).rejects.toThrow(
      FlowUnboundedError,
    );
  });
});

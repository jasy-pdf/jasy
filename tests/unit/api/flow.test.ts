// A Flow pours its content through the Regions of a template, region after region, page after page.
// Every Region boundary is a real break boundary; on its last page the Flow shrinks to what it used.
import { describe, it, expect } from "vitest";
import { Document, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { Box, Column, Expanded, Row, Spacer } from "../../../src/lib/api/layout.ts";
import { Canvas } from "../../../src/lib/api/content.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { Table } from "../../../src/lib/api/table.ts";
import {
  ColumnBreak,
  Flow,
  FlowUnboundedError,
  FlowWithoutRegionError,
  Region,
  RegionOutsideFlowError,
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

  it("in a box with a height it fills that box; the rest is cut and reported", async () => {
    const seen: Diagnostic[] = [];
    const pages = await render(
      [Box({ height: 60 }, [Flow({ template: twoColumns }, lines(0, 40))])],
      (d) => seen.push(d),
    );
    expect(pages.length).toBe(1);
    const drawn = pages[0]!.map((r) => r.text);
    expect(drawn.length).toBeGreaterThan(5);
    expect(drawn.length).toBeLessThan(40);
    expect(seen.some((d) => d.code === "overflow-clipped")).toBe(true);
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

  it("a Flow with no height to take (a Row without a height)", async () => {
    await expect(render([Row([Flow({ template: twoColumns }, lines(0, 3))])])).rejects.toThrow(
      FlowUnboundedError,
    );
  });
});

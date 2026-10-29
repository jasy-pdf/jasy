// `Expanded(child)` makes the CHILD the flex item (CSS `flex: 1` on the child itself): its own width or
// height gives way to its share, which never drops below what its content needs nor rises above its max.
import { describe, it, expect } from "vitest";
import { Box, Column, Row, Expanded, Rotated } from "../../../src/lib/api/layout.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { testMetrics } from "../support/metrics.ts";

const ctx = () =>
  ({ metrics: testMetrics(), pageConfig: { width: 595, height: 842, margin: 0 } }) as never;

const layout = (el: ReturnType<typeof Row>, width: number) =>
  el.calculateLayout(BoxConstraints.loose(width, Infinity), { x: 0, y: 0 }, ctx());

const widthOf = (el: { getProps(): { width?: unknown } }) => el.getProps().width as number;

const LONG = "Verpflichtungserklaerung";

describe("the child of an Expanded fills its share", () => {
  it("its own width gives way to its share", () => {
    const inner = Box({ width: 40 }, [Text("B", { size: 12 })]);
    layout(Row([Box({ width: 200 }, []), Expanded(inner)]), 500);
    expect(widthOf(inner)).toBe(300);
  });

  it("a Rotated around it is paint-only: the Expanded inside still flexes", () => {
    const inner = Box([]);
    layout(Row([Box({ width: 200 }, []), Rotated({ angle: 5 }, Expanded(inner))]), 500);
    expect(widthOf(inner)).toBe(300);
  });

  it("in a Column, its own height does", () => {
    const inner = Box({ height: 40 }, []);
    Column({ height: 300 }, [Box({ height: 100 }, []), Expanded(inner)]).calculateLayout(
      BoxConstraints.loose(200, 300),
      { x: 0, y: 0 },
      ctx(),
    );
    expect(inner.getProps().height).toBe(200);
  });

  it("content that fits leaves the equal split untouched", () => {
    const a = Box([Text("a", { size: 12 })]);
    const b = Box([Text("b", { size: 12 })]);
    layout(Row([Expanded(a), Expanded(b)]), 200);
    expect(widthOf(a)).toBe(100);
    expect(widthOf(b)).toBe(100);
  });

  it("next to a full-width sibling, the sibling makes room instead of the Expanded collapsing to 0", () => {
    const fixed = Box({ width: 200 }, [Text("x", { size: 12 })]);
    const inner = Box({ width: 40 }, [Text("B", { size: 12 })]);
    layout(Row([fixed, Expanded(inner)]), 200);
    const floor = inner.minIntrinsicMain(true, ctx());
    expect(floor).toBeGreaterThan(0);
    // Chrome, `<div style="flex:1; width:40">B</div>` beside a 200 wide sibling: the item keeps its text.
    expect(widthOf(inner)).toBeCloseTo(floor, 6);
    expect(widthOf(fixed) + widthOf(inner)).toBeCloseTo(200, 6);
  });

  it("a share below the content is frozen there and the rest goes to the others", () => {
    const short = Box([Text("a", { size: 12 })]);
    const long = Box([Text(LONG, { size: 12 })]);
    layout(Row([Expanded(short), Expanded(long)]), 400);
    const word = long.minIntrinsicMain(true, ctx());
    expect(word).toBeGreaterThan(200); // wider than an equal half - the case this is about
    expect(widthOf(long)).toBeCloseTo(word, 6);
    expect(widthOf(short)).toBeCloseTo(400 - word, 6);
  });

  it("a max is frozen too, and the rest goes to the others", () => {
    const capped = Box({ maxWidth: 100 }, []);
    const free = Box([]);
    layout(Row([Expanded(capped), Expanded(free)]), 500);
    expect(widthOf(capped)).toBe(100);
    expect(widthOf(free)).toBe(400);
  });
});

describe("down a column, and in a sized box", () => {
  const laidOut = (el: ReturnType<typeof Column>, width: number, height: number) =>
    el.calculateLayout(BoxConstraints.loose(width, height), { x: 0, y: 0 }, ctx());
  const lines = (n: number) => Array.from({ length: n }, (_, i) => Text(`line ${i}`, { size: 10 }));

  it("an Expanded keeps its content's height: the one after it starts below, never on top", () => {
    const a = Column(lines(16));
    const b = Column(lines(2));
    laidOut(Column([Expanded(a), Expanded(b)]), 200, 260);
    const aEnd = (a.getProps().y as number) + (a.getProps().height as number);
    expect(b.getProps().y).toBeGreaterThanOrEqual(aEnd);
  });

  it("a single Expanded in a Box with a height fills it - with a border and padding too", () => {
    const cases = [
      [{ height: 100 }, 100],
      [{ height: 100, border: "black", borderWidth: 2 }, 96],
      [{ height: 100, padding: 10 }, 80],
    ] as const;
    for (const [opts, expected] of cases) {
      const inner = Box([]);
      Box(opts, [Expanded(inner)]).calculateLayout(
        BoxConstraints.loose(200, 300),
        { x: 0, y: 0 },
        ctx(),
      );
      expect(inner.getProps().height).toBe(expected);
    }
  });

  it("a % height across the line resolves against the line once, not against itself again", () => {
    const half = Box({ height: "50%" }, []);
    Row({ height: 200 }, [Expanded(half), Expanded(Box([]))]).calculateLayout(
      BoxConstraints.loose(260, 300),
      { x: 0, y: 0 },
      ctx(),
    );
    expect(half.getProps().height).toBe(100);
  });
});

// `Expanded(child)` makes the CHILD the flex item (CSS `flex: 1` on the child itself): its own width or
// height gives way to its share.
import { describe, it, expect } from "vitest";
import { Box, Column, Row, Expanded } from "../../../src/lib/api/layout.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { testMetrics } from "../support/metrics.ts";

const ctx = () =>
  ({ metrics: testMetrics(), pageConfig: { width: 595, height: 842, margin: 0 } }) as never;

const layout = (el: ReturnType<typeof Row>, width: number) =>
  el.calculateLayout(BoxConstraints.loose(width, Infinity), { x: 0, y: 0 }, ctx());

const widthOf = (el: { getProps(): { width?: unknown } }) => el.getProps().width as number;

describe("the child of an Expanded fills its share", () => {
  it("its own width gives way to its share", () => {
    const inner = Box({ width: 40 }, [Text("B", { size: 12 })]);
    layout(Row([Box({ width: 200 }, []), Expanded(inner)]), 500);
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
});

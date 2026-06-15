import { describe, it, expect } from "vitest";
import { RowElement } from "../../../src/lib/elements/row-element";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { ExpandedElement } from "../../../src/lib/elements/layout/expanded-element";
import { TextElement } from "../../../src/lib/elements/text-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { FontMetrics } from "../../../src/lib/utils/font-metrics";

const box = (width: number, height: number) =>
  new RectangleElement({ x: 0, y: 0, children: [], width, height, borderWidth: 0 });

describe("RowElement", () => {
  it("lays children left-to-right with a gap; fills width, height = tallest", () => {
    const a = box(40, 20);
    const b = box(30, 30);
    const row = new RowElement({ children: [a, b], gap: 8 });

    const size = row.calculateLayout(
      BoxConstraints.loose(200, Infinity),
      { x: 10, y: 5 },
      {} as LayoutContext
    );

    expect(a.getProps().x).toBe(10);
    expect(b.getProps().x).toBe(58); // 10 + 40 + gap 8
    expect(size.width).toBe(200); // fills the offered width
    expect(size.height).toBe(30); // tallest child
  });

  it("a Spacer pushes the last child to the right edge (title … page number)", () => {
    // deterministic metrics: 6 pt per char
    const metrics = {
      getStringWidth: (t: string) => t.length * 6,
      getCharWidth: () => 3,
    } as unknown as FontMetrics;
    const ctx = { metrics, pageConfig: {} } as LayoutContext;

    const left = new TextElement({ fontSize: 10, content: "Left" }); // width 24
    const spacer = new ExpandedElement({ flex: 1, child: box(0, 0) });
    const right = new TextElement({ fontSize: 10, content: "Right" }); // width 30
    const row = new RowElement({ children: [left, spacer, right] });

    row.calculateLayout(
      BoxConstraints.loose(200, Infinity),
      { x: 0, y: 0 },
      ctx
    );

    expect(left.getProps().x).toBe(0);
    // remaining = 200 - 24 - 30 = 146 -> spacer fills it -> right at 24 + 146 = 170.
    expect(right.getProps().x).toBe(170);
  });
});

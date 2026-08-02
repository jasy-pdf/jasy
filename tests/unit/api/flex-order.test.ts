import { describe, it, expect } from "vitest";
import { Box, Column, Row } from "../../../src/lib/api/layout.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";

// `order` and `reverse` both decide WHERE a child is laid out, never what the tree contains - so a
// tagged PDF keeps exposing the source reading order, which is what CSS says too.

const ctx = {} as LayoutContext;
const tile = (opts: Record<string, unknown> = {}) =>
  Box({ borderWidth: 0, width: 40, height: 20, ...opts }, []);

/** The laid-out x of each child of a Row, in TREE order - so a change of position is visible. */
const xs = (row: ReturnType<typeof Row>, w = 400) => {
  row.calculateLayout(BoxConstraints.loose(w, 200), { x: 0, y: 0 }, ctx);
  return (row as unknown as { children: { getProps(): { x: number } }[] }).children.map(
    (c) => c.getProps().x,
  );
};
const ys = (col: ReturnType<typeof Column>, h = 400) => {
  col.calculateLayout(BoxConstraints.loose(200, h), { x: 0, y: 0 }, ctx);
  return (col as unknown as { children: { getProps(): { y: number } }[] }).children.map(
    (c) => c.getProps().y,
  );
};

describe("order", () => {
  it("moves a child without moving it in the tree", () => {
    // The third child asks to go first; the tree order (and therefore the reading order) is unchanged.
    const row = Row({ gap: 10 }, [tile(), tile(), tile({ order: -1 })]);
    expect(xs(row)).toEqual([50, 100, 0]);
  });

  it("keeps source order for ties, so a partial ordering is predictable", () => {
    const row = Row({ gap: 10 }, [tile({ order: 1 }), tile({ order: 1 }), tile({ order: 0 })]);
    expect(xs(row)).toEqual([50, 100, 0]);
  });

  it("changes nothing when nobody sets it", () => {
    expect(xs(Row({ gap: 10 }, [tile(), tile(), tile()]))).toEqual([0, 50, 100]);
  });

  it("refuses a non-finite value", () => {
    expect(() => tile({ order: Infinity })).toThrow(/Invalid order/);
  });
});

describe("reverse", () => {
  it("lays a Row out backwards", () => {
    const row = Row({ gap: 10, reverse: true }, [tile(), tile(), tile()]);
    expect(xs(row)).toEqual([100, 50, 0]);
  });

  it("lays a Column out bottom to top", () => {
    const col = Column({ gap: 10, reverse: true }, [tile(), tile(), tile()]);
    expect(ys(col)).toEqual([60, 30, 0]);
  });

  it("composes with order - order first, then the reversal", () => {
    // order puts the third child first; reversing then sends it to the far end.
    const row = Row({ gap: 10, reverse: true }, [tile(), tile(), tile({ order: -1 })]);
    expect(xs(row)).toEqual([50, 0, 100]);
  });
});

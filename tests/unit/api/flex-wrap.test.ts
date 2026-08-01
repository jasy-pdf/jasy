import { describe, it, expect } from "vitest";
import { Box, Row } from "../../../src/lib/api/layout.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";

// `wrap` splits the children onto further lines when they do not fit. The single-line engine is
// unchanged and simply runs once per line - which is what keeps every non-wrapping document identical.

const ctx = {} as LayoutContext;
const tile = (w: number, h = 20) => Box({ borderWidth: 0, width: w, height: h }, []);

/** Where each child ended up: [x, y] per child, in tree order. */
const places = (row: ReturnType<typeof Row>, w = 300, h = 400) => {
  row.calculateLayout(BoxConstraints.loose(w, h), { x: 0, y: 0 }, ctx);
  return (row as unknown as { children: { getProps(): { x: number; y: number } }[] }).children.map(
    (c) => [c.getProps().x, c.getProps().y] as [number, number],
  );
};

describe("without wrap nothing changes", () => {
  it("keeps overflowing on one line, as it always did", () => {
    const row = Row({ width: 300 }, [tile(200), tile(200)]);
    expect(places(row)).toEqual([
      [0, 0],
      [200, 0],
    ]);
  });
});

describe("wrapping", () => {
  it("moves a child that does not fit onto the next line", () => {
    const row = Row({ width: 300, wrap: true }, [tile(200), tile(200)]);
    expect(places(row)).toEqual([
      [0, 0],
      [0, 20],
    ]);
  });

  it("counts the gap when deciding, and uses it between the lines too", () => {
    // 140 + 10 + 140 = 290 fits in 300; adding a third would not, so it starts a line 10 below.
    const row = Row({ width: 300, gap: 10, wrap: true }, [tile(140), tile(140), tile(140)]);
    expect(places(row)).toEqual([
      [0, 0],
      [150, 0],
      [0, 30],
    ]);
  });

  it("lets a child wider than the line OVERFLOW rather than squashing it", () => {
    // CSS does not shrink an item to make it fit - that is what `flexShrink` is for, and it is off by
    // default. The child keeps its width, takes a line of its own, and runs past the edge.
    const row = Row({ width: 100, wrap: true }, [tile(50), tile(400), tile(50)]);
    row.calculateLayout(BoxConstraints.loose(100, 400), { x: 0, y: 0 }, ctx);
    const kids = (row as unknown as { children: { getProps(): { width?: number; y: number } }[] })
      .children;
    expect(kids[1].getProps().width).toBe(400); // not squashed to 100
    expect(kids.map((c) => c.getProps().y)).toEqual([0, 20, 40]);
  });

  it("does not open an empty line when the FIRST child is already too wide", () => {
    // Without the guard an empty line is pushed ahead of it. That is invisible without a gap - an
    // empty line is 0 tall - but with one it costs a whole gap of blank space at the top.
    const row = Row({ width: 100, gap: 10, wrap: true }, [tile(400), tile(50)]);
    expect(places(row).map((p) => p[1])).toEqual([0, 30]);
  });

  it("lets the gap itself decide the break", () => {
    // 150 + 150 is exactly 300 and would fit - but the 10pt gap between them does not, so the second
    // child moves down. Ignoring the gap here keeps them on one line and overflows by 10.
    const row = Row({ width: 300, gap: 10, wrap: true }, [tile(150), tile(150)]);
    expect(places(row)).toEqual([
      [0, 0],
      [0, 30],
    ]);
  });

  it("stacks three lines in order", () => {
    const row = Row({ width: 100, wrap: true }, [tile(60), tile(60), tile(60)]);
    expect(places(row).map((p) => p[1])).toEqual([0, 20, 40]);
  });
});

describe("alignContent places the BLOCK of lines", () => {
  const three = () => [tile(60), tile(60), tile(60)];

  it("starts at the top by default", () => {
    expect(places(Row({ width: 100, wrap: true }, three()), 100, 200).map((p) => p[1])).toEqual([
      0, 20, 40,
    ]);
  });

  it("centres them", () => {
    // Three 20pt lines = 60 in a 200pt box: 140 of slack, so 70 above.
    expect(
      places(Row({ width: 100, wrap: true, alignContent: "center" }, three()), 100, 200).map(
        (p) => p[1],
      ),
    ).toEqual([70, 90, 110]);
  });

  it("pushes them to the end", () => {
    expect(
      places(Row({ width: 100, wrap: true, alignContent: "end" }, three()), 100, 200).map(
        (p) => p[1],
      ),
    ).toEqual([140, 160, 180]);
  });

  it("spreads them with 'between'", () => {
    expect(
      places(Row({ width: 100, wrap: true, alignContent: "between" }, three()), 100, 200).map(
        (p) => p[1],
      ),
    ).toEqual([0, 90, 180]);
  });
});

describe("composing with the rest", () => {
  it("applies `order` before the lines are cut, not within them", () => {
    // The last child asks to go first, so it lands on line one and the others follow.
    const row = Row({ width: 100, wrap: true }, [tile(60), tile(60), tile(60, 20)]);
    (row as never as { children: { order: number }[] }).children[2].order = -1;
    expect(places(row).map((p) => p[1])).toEqual([20, 40, 0]);
  });

  it("stretches a child to its own LINE, not to the whole container", () => {
    // `cross: stretch` is the default. Each line must be offered its OWN extent - hand every line the
    // container's height instead and the auto-sized child grows to 400 rather than matching the 30pt
    // tile it shares a line with.
    const auto = () => Box({ borderWidth: 0, width: 60 }, []);
    const row = Row({ width: 130, wrap: true }, [tile(60, 30), auto(), tile(60, 50), auto()]);
    row.calculateLayout(BoxConstraints.loose(130, 400), { x: 0, y: 0 }, ctx);
    const kids = (row as unknown as { children: { getProps(): { height?: number; y: number } }[] })
      .children;
    expect(kids[1].getProps().height).toBe(30); // line one is 30 tall
    expect(kids[3].getProps().height).toBe(50); // line two is 50 tall
    expect(kids[2].getProps().y).toBe(30); // and line two starts below line one
  });

  it("wrapping an unbounded axis is a no-op, not an error", () => {
    // There is no edge to wrap at; the children simply keep going, as they would without `wrap`.
    const row = Row({ wrap: true }, [tile(200), tile(200)]);
    row.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx);
    const ys = (row as unknown as { children: { getProps(): { y: number } }[] }).children.map(
      (c) => c.getProps().y,
    );
    expect(ys).toEqual([0, 0]);
  });
});

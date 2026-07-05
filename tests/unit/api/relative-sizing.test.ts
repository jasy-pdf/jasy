import { describe, it, expect } from "vitest";
import { Box, Column, Row } from "../../../src/lib/api/layout";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";

// A childless, border-less box so its size is purely what relative sizing resolves to (no border,
// no content). Layout needs no metrics because there are no children to measure.
const box = (opts: { width?: `${number}%` | number; height?: `${number}%` | number }) =>
  Box({ borderWidth: 0, ...opts }, []);
const ctx = {} as LayoutContext;

describe("relative sizing (Box width/height as a percentage)", () => {
  it("width '50%' takes half the offered (bounded) width", () => {
    const size = box({ width: "50%" }).calculateLayout(
      BoxConstraints.loose(200, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.width).toBe(100);
  });

  it("height '50%' takes half the offered (bounded) height", () => {
    const size = box({ height: "50%" }).calculateLayout(
      BoxConstraints.loose(200, 400),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.height).toBe(200);
  });

  it("a fixed point width still passes straight through", () => {
    const size = box({ width: 120 }).calculateLayout(
      BoxConstraints.loose(200, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.width).toBe(120);
  });

  it("a percentage over 100% is clamped to the region (never overflows the parent)", () => {
    const size = box({ width: "150%" }).calculateLayout(
      BoxConstraints.loose(200, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.width).toBe(200);
  });

  it("a percentage width is a no-op in an unbounded region (shrink-wraps instead)", () => {
    // A fixed 40pt child so shrink-wrap is observable; maxWidth Infinity = unbounded.
    const child = new RectangleElement({ x: 0, y: 0, children: [], width: 40, height: 20 });
    const size = Box({ borderWidth: 0, width: "50%" }, [child]).calculateLayout(
      BoxConstraints.loose(Infinity, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.width).toBe(40); // the child's width, not a fraction of infinity
  });
});

describe("relative sizing on flex stacks (Column / Row)", () => {
  it("a Column takes a percentage of the offered width", () => {
    const size = Column({ width: "50%" }, []).calculateLayout(
      BoxConstraints.loose(400, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.width).toBe(200);
  });

  it("a Row takes a percentage of the offered width", () => {
    const size = Row({ width: "50%" }, []).calculateLayout(
      BoxConstraints.loose(400, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.width).toBe(200);
  });

  it("a Column height percentage resolves against a bounded height", () => {
    const size = Column({ height: "50%" }, []).calculateLayout(
      BoxConstraints.loose(400, 300),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.height).toBe(150);
  });

  it("without a size a Column still fills a bounded width (unchanged behavior)", () => {
    const size = Column([]).calculateLayout(
      BoxConstraints.loose(400, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    expect(size.width).toBe(400);
  });
});

describe("percentage children inside a Row (resolve against the line minus the gaps)", () => {
  const box = (w: `${number}%`) => Box({ borderWidth: 0, width: w }, []);

  it("two 50% children tile the Row exactly, with the gap between them", () => {
    const b1 = box("50%");
    const b2 = box("50%");
    Row({ gap: 20 }, [b1, b2]).calculateLayout(
      BoxConstraints.loose(400, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    // percent base = 400 - 20 gap = 380 -> each 190; they meet the gap, last edge = row width.
    expect(b1.getProps().width).toBe(190);
    expect(b2.getProps().width).toBe(190);
    expect(b2.getProps().x).toBe(210); // 190 + 20 gap
    expect(b2.getProps().x + b2.getProps().width).toBe(400); // no overflow
  });

  it("three 33% children fit inside the Row instead of overflowing the gaps", () => {
    const boxes = [box("33%"), box("33%"), box("33%")];
    Row({ gap: 10 }, boxes).calculateLayout(
      BoxConstraints.loose(310, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    // base = 310 - 20 gaps = 290; each 0.33*290 = 95.7; last right edge stays within 310.
    for (const b of boxes) expect(b.getProps().width).toBeCloseTo(95.7, 3);
    const last = boxes[2].getProps();
    expect(last.x + last.width).toBeLessThanOrEqual(310);
  });

  it("a percentage child stays a no-op in an unbounded Row (nothing to resolve against)", () => {
    const b = Box({ borderWidth: 0, width: "50%" }, []);
    Row({}, [b]).calculateLayout(BoxConstraints.loose(Infinity, Infinity), { x: 0, y: 0 }, ctx);
    expect(b.getProps().width).toBe(0); // no bounded main axis -> shrink-wraps (empty box)
  });
});

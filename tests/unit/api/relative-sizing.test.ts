import { describe, it, expect } from "vitest";
import { Box } from "../../../src/lib/api/layout";
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

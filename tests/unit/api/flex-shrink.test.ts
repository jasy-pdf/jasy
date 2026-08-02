import { describe, it, expect } from "vitest";
import { Box, Row } from "../../../src/lib/api/layout.ts";
import { Image } from "../../../src/lib/api/content.ts";
import { CustomBytesImage } from "../../../src/lib/elements/image-element.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";

// `flexShrink` gives main-axis space back when the line overflows, weighted by the child's OWN size -
// so a wide item yields more than a narrow one. Default 0, deliberately unlike CSS's 1: shrinking
// changes what a document looks like, and every document written before this must lay out unchanged.

const ctx = {} as LayoutContext;
const tile = (width: number, opts: Record<string, unknown> = {}) =>
  Box({ borderWidth: 0, width, height: 20, ...opts }, []);

const widths = (children: unknown[], line = 400) => {
  const row = Row({ width: line }, children as never);
  row.calculateLayout(BoxConstraints.loose(line, 200), { x: 0, y: 0 }, ctx);
  return (row as unknown as { children: { getProps(): { width?: number } }[] }).children.map(
    (c) => c.getProps().width,
  );
};

describe("nothing shrinks unless it says so", () => {
  it("leaves an overflowing line alone by default", () => {
    // 3 x 200 in a 400pt line: it overflows, and that is exactly what it did before this existed.
    expect(widths([tile(200), tile(200), tile(200)])).toEqual([200, 200, 200]);
  });
});

describe("giving space back", () => {
  it("shrinks the one child that volunteered, by the whole overflow", () => {
    // 200 + 300 = 500 in a 400pt line: 100 too much, and only the second offered.
    expect(widths([tile(200), tile(300, { flexShrink: 1 })])).toEqual([200, 200]);
  });

  it("weights the share by each child's own size, as CSS does", () => {
    // 300 + 100 = 400 over a 200pt line: 200 too much. Weights are 300 and 100, so the wide one
    // gives up 150 and the narrow one 50 - not half each.
    expect(widths([tile(300, { flexShrink: 1 }), tile(100, { flexShrink: 1 })], 200)).toEqual([
      150, 50,
    ]);
  });

  it("respects a higher willingness", () => {
    // Weights 2x200 and 1x200: the eager one gives up two thirds of the 300 overflow.
    expect(widths([tile(200, { flexShrink: 2 }), tile(200, { flexShrink: 1 })], 100)).toEqual([
      0, 100,
    ]);
  });

  it("bottoms out at zero rather than going negative", () => {
    // Reachable only when the GAPS alone outgrow the line: the overflow is then larger than everything
    // the children add up to. Two 50pt tiles with a 300pt gap in a 100pt line.
    const row = Row({ width: 100, gap: 300 }, [
      tile(50, { flexShrink: 1 }),
      tile(50, { flexShrink: 1 }),
    ] as never);
    row.calculateLayout(BoxConstraints.loose(100, 200), { x: 0, y: 0 }, ctx);
    const w = (row as unknown as { children: { getProps(): { width?: number } }[] }).children.map(
      (c) => c.getProps().width,
    );
    expect(w).toEqual([0, 0]);
  });

  it("does nothing when the line is NOT overflowing", () => {
    expect(widths([tile(100, { flexShrink: 1 }), tile(100)])).toEqual([100, 100]);
  });

  it("refuses a negative willingness", () => {
    expect(() => tile(100, { flexShrink: -1 })).toThrow(/Invalid flexShrink/);
  });
});

describe("an Image is a flex child like any other", () => {
  // `ImageOptions` extends `BoundsInput`, so the prop is offered and documented on an Image. It was
  // accepted and then dropped on the floor - the picture simply overflowed.
  const pic = (width: number, opts: Record<string, unknown> = {}) =>
    Image(new CustomBytesImage(new Uint8Array([1])), { width, height: 20, ...opts });

  it("honours flexShrink on an Image", () => {
    // 300 + 200 in a 400pt line: 100 too much, shared out by each picture's own width.
    const [a, b] = widths([pic(300, { flexShrink: 1 }), pic(200, { flexShrink: 1 })]);
    expect(a! + b!).toBeCloseTo(400, 5); // the line is exactly filled...
    expect(a!).toBeCloseTo(240, 5); // ...and the wide one gave up 60 of the 100, the narrow one 40
    expect(b!).toBeCloseTo(160, 5);
  });

  it("still leaves an Image alone without it", () => {
    expect(widths([pic(300), pic(300)])).toEqual([300, 300]);
  });
});

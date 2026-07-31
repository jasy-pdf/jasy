import { describe, it, expect } from "vitest";
import { Box, Column, Row } from "../../../src/lib/api/layout.ts";
import { Image } from "../../../src/lib/api/content.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";

// `aspectRatio`, `minWidth` / `maxWidth` / `minHeight` / `maxHeight` through the public factories.
// The resolver itself is covered in layout/resolve-size.test.ts; what matters here is that all four
// sized factories reach it and that the props survive the api -> element hop.

const ctx = {} as LayoutContext;
const lay = (el: ReturnType<typeof Box>, w = 400, h = 600) =>
  el.calculateLayout(BoxConstraints.loose(w, h), { x: 0, y: 0 }, ctx);

const box = (opts: Record<string, unknown>) => Box({ borderWidth: 0, ...opts }, []);

describe("aspectRatio reaches every sized factory", () => {
  it("Box: a pinned width gives the height", () => {
    expect(lay(box({ width: 300, aspectRatio: 3 / 2 })).height).toBe(200);
  });

  it("Box: neither axis pinned takes the offered width", () => {
    const size = lay(box({ aspectRatio: 2 }), 300, 600);
    expect([size.width, size.height]).toEqual([300, 150]);
  });

  it("Column and Row take it too", () => {
    expect(lay(Column({ width: 200, aspectRatio: 2 }, [])).height).toBe(100);
    expect(lay(Row({ width: 200, aspectRatio: 4 }, [])).height).toBe(50);
  });

  it("Image: an explicit ratio overrides the image's own", () => {
    // No intrinsic size is resolved here (that needs the async pre-pass), so this also proves the
    // explicit ratio does not depend on it.
    expect(lay(Image("x.png", { width: 240, aspectRatio: 3 })).height).toBe(80);
  });

  it("rejects a ratio that is not a positive number", () => {
    expect(() => box({ aspectRatio: 0 })).toThrow(/aspectRatio/);
    expect(() => box({ aspectRatio: -2 })).toThrow(/width \/ height/);
  });
});

describe("min / max through the factories", () => {
  it("caps an explicit size", () => {
    expect(lay(box({ width: 380, maxWidth: 200 })).width).toBe(200);
  });

  it("raises one below the minimum", () => {
    expect(lay(box({ width: 40, minWidth: 120 })).width).toBe(120);
  });

  it("caps a box that would otherwise FILL the offered width", () => {
    // The case that needs the narrowed constraints rather than a clamped value: with no width at all
    // a Box fills, and `maxWidth` has to survive that path.
    expect(lay(box({ maxWidth: 150 }), 400).width).toBe(150);
  });

  it("caps a box that shrink-wraps its content", () => {
    // Unbounded width: the box sizes to its children, and the bound still applies.
    const el = Box({ borderWidth: 0, maxWidth: 60 }, [Box({ borderWidth: 0, width: 300 }, [])]);
    expect(el.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx).width).toBe(60);
  });

  it("accepts percentages", () => {
    expect(lay(box({ width: 400, maxWidth: "25%" }), 400).width).toBe(100);
  });

  it("beats the ratio, the way an explicit bound does in CSS", () => {
    expect(lay(box({ width: 300, aspectRatio: 3, minHeight: 250 })).height).toBe(250);
  });
});

describe("nothing asked for changes nothing", () => {
  it("a plain Box still fills the offered width", () => {
    expect(lay(box({})).width).toBe(400);
  });
});

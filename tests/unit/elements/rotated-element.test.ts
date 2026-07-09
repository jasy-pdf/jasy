import { describe, it, expect } from "vitest";
import { RotatedElement } from "../../../src/lib/elements/layout/rotated-element";
import { Rotated } from "../../../src/lib/api/layout";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";

const ctx = {} as LayoutContext;
const box = (w: number, h: number) =>
  new RectangleElement({ x: 0, y: 0, children: [], width: w, height: h, borderWidth: 0 });

describe("RotatedElement (paint-only, layout-transparent)", () => {
  it("reports the child's box unchanged (no reflow around the rotated shape)", () => {
    const child = box(100, 50);
    const size = new RotatedElement({ angle: 45, child }).calculateLayout(
      BoxConstraints.loose(200, Infinity),
      { x: 10, y: 20 },
      ctx,
    );
    expect(size).toEqual({ width: 100, height: 50 }); // same as the child, rotation is paint-only
  });

  it("lays the child out at the given offset and records the box + angle for the renderer", () => {
    const child = box(100, 50);
    const rot = new RotatedElement({ angle: 30, child });
    rot.calculateLayout(BoxConstraints.loose(200, Infinity), { x: 10, y: 20 }, ctx);
    const props = rot.getProps();
    expect(props.angle).toBe(30);
    expect({ x: props.x, y: props.y, width: props.width, height: props.height }).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    expect(child.getProps().x).toBe(10); // child was actually placed at the offset
  });

  it("the Rotated factory wraps the child in a RotatedElement carrying the angle", () => {
    const r = Rotated({ angle: 45 }, box(10, 10));
    expect(r).toBeInstanceOf(RotatedElement);
    r.calculateLayout(BoxConstraints.loose(100, Infinity), { x: 0, y: 0 }, ctx);
    expect(r.getProps().angle).toBe(45);
  });
});

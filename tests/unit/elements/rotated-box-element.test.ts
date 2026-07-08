import { describe, it, expect } from "vitest";
import { RotatedBoxElement } from "../../../src/lib/elements/layout/rotated-box-element";
import { RotatedBox } from "../../../src/lib/api/layout";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";

const ctx = {} as LayoutContext;
const box = (w: number, h: number) =>
  new RectangleElement({ x: 0, y: 0, children: [], width: w, height: h, borderWidth: 0 });
const layout = (turns: number, child: RectangleElement) =>
  new RotatedBoxElement({ turns, child }).calculateLayout(
    BoxConstraints.loose(400, 400),
    { x: 0, y: 0 },
    ctx,
  );

describe("RotatedBoxElement (layout-aware quarter-turns)", () => {
  it("a 90-turn swaps width and height (100x20 -> 20x100)", () => {
    expect(layout(1, box(100, 20))).toEqual({ width: 20, height: 100 });
  });

  it("a 270-turn also swaps the axes", () => {
    expect(layout(3, box(100, 20))).toEqual({ width: 20, height: 100 });
  });

  it("a 180-turn (and 0) keeps width and height", () => {
    expect(layout(2, box(100, 20))).toEqual({ width: 100, height: 20 });
    expect(layout(0, box(100, 20))).toEqual({ width: 100, height: 20 });
  });

  it("normalizes the turn count and exposes turns*90 as the angle", () => {
    expect(new RotatedBoxElement({ turns: 5, child: box(10, 10) }).getProps().angle).toBe(90); // 5 -> 1
    expect(new RotatedBoxElement({ turns: -1, child: box(10, 10) }).getProps().angle).toBe(270); // -1 -> 3
  });

  it("places the child centered on the box center, so a center-rotation maps it onto the box", () => {
    // box is 20x100 at (0,0) -> center (10,50); the 100x20 child centered -> offset (10-50, 50-10).
    const child = box(100, 20);
    layout(1, child);
    expect({ x: child.getProps().x, y: child.getProps().y }).toEqual({ x: -40, y: 40 });
  });

  it("the RotatedBox factory wraps the child in a RotatedBoxElement", () => {
    expect(RotatedBox({ turns: 1 }, box(10, 10))).toBeInstanceOf(RotatedBoxElement);
  });
});

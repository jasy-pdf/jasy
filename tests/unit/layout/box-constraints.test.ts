import { describe, it, expect } from "vitest";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";

describe("BoxConstraints", () => {
  it("defaults to fully unbounded", () => {
    const c = new BoxConstraints();
    expect(c.minWidth).toBe(0);
    expect(c.maxWidth).toBe(Infinity);
    expect(c.minHeight).toBe(0);
    expect(c.maxHeight).toBe(Infinity);
    expect(c.hasBoundedWidth).toBe(false);
    expect(c.hasBoundedHeight).toBe(false);
  });

  it("tight() forces min === max on both axes", () => {
    const c = BoxConstraints.tight(100, 50);
    expect([c.minWidth, c.maxWidth, c.minHeight, c.maxHeight]).toEqual([
      100, 100, 50, 50,
    ]);
    expect(c.isTight).toBe(true);
    expect(c.hasBoundedWidth).toBe(true);
    expect(c.hasBoundedHeight).toBe(true);
  });

  it("loose() caps the max but keeps min at zero", () => {
    const c = BoxConstraints.loose(200, 80);
    expect([c.minWidth, c.maxWidth, c.minHeight, c.maxHeight]).toEqual([
      0, 200, 0, 80,
    ]);
    expect(c.isTight).toBe(false);
  });

  it("tightFor() is tight where given, unbounded elsewhere", () => {
    const c = BoxConstraints.tightFor({ width: 120 });
    expect([c.minWidth, c.maxWidth]).toEqual([120, 120]);
    expect([c.minHeight, c.maxHeight]).toEqual([0, Infinity]);
    expect(c.hasBoundedHeight).toBe(false);
  });

  it("constrains a desired size into the box", () => {
    const c = new BoxConstraints(50, 100, 0, 40);
    expect(c.constrainWidth(10)).toBe(50); // below min → min
    expect(c.constrainWidth(75)).toBe(75); // within range → unchanged
    expect(c.constrainWidth(200)).toBe(100); // above max → max
    expect(c.constrainHeight(60)).toBe(40);
    expect(c.constrain({ width: 200, height: 5 })).toEqual({
      width: 100,
      height: 5,
    });
  });

  it("deflate() shrinks both bounds and clamps at zero", () => {
    const c = new BoxConstraints(10, 100, 0, 50).deflate(20, 10);
    // minWidth 10-20 floored to 0; maxWidth 100-20=80; maxHeight 50-10=40.
    expect([c.minWidth, c.maxWidth, c.minHeight, c.maxHeight]).toEqual([
      0, 80, 0, 40,
    ]);
  });

  it("deflate() leaves an unbounded axis unbounded", () => {
    const c = new BoxConstraints(0, Infinity, 0, 100).deflate(15, 15);
    expect(c.maxWidth).toBe(Infinity);
    expect(c.maxHeight).toBe(85);
  });

  it("enforce() clamps constraints inside the parent's range", () => {
    const parent = new BoxConstraints(0, 100, 0, 100);
    const child = new BoxConstraints(20, 200, 0, 50).enforce(parent);
    expect([child.minWidth, child.maxWidth]).toEqual([20, 100]); // max capped to 100
    expect([child.minHeight, child.maxHeight]).toEqual([0, 50]);
  });
});

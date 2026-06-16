import { describe, it, expect } from "vitest";
import { toEdges } from "../../../src/lib/api/insets";

describe("toEdges - every Insets form normalizes to [top, right, bottom, left]", () => {
  it("a single number is all four sides", () => {
    expect(toEdges(10)).toEqual([10, 10, 10, 10]);
  });

  it("the {x, y} axis form maps to the right edges", () => {
    expect(toEdges({ x: 8, y: 4 })).toEqual([4, 8, 4, 8]); // [top=y, right=x, bottom=y, left=x]
    expect(toEdges({ x: 8 })).toEqual([0, 8, 0, 8]); // missing axis defaults to 0
    expect(toEdges({ y: 4 })).toEqual([4, 0, 4, 0]);
  });

  it("the per-side object form fills missing sides with 0", () => {
    expect(toEdges({ top: 1, right: 2, bottom: 3, left: 4 })).toEqual([1, 2, 3, 4]);
    expect(toEdges({ left: 5 })).toEqual([0, 0, 0, 5]);
  });

  it("a 4-tuple passes through in engine order", () => {
    expect(toEdges([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });

  it("an empty object is all-zero", () => {
    expect(toEdges({})).toEqual([0, 0, 0, 0]);
  });
});

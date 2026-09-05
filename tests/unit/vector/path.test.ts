import { describe, it, expect } from "vitest";
import { quadToCubic } from "../../../src/lib/vector/path.ts";

// PDF has no quadratic operator, so TrueType outlines and SVG's Q/T both have to raise the degree.
// The conversion is an exact identity, which is why one shared function is safe.

describe("quadToCubic", () => {
  it("keeps the endpoints", () => {
    const c = quadToCubic(0, 0, 5, 10, 10, 0);
    expect([c.x, c.y]).toEqual([10, 0]);
  });

  it("puts both controls two thirds of the way to the quadratic's control point", () => {
    const c = quadToCubic(0, 0, 6, 9, 12, 0);
    expect([c.x1, c.y1]).toEqual([4, 6]);
    expect([c.x2, c.y2]).toEqual([8, 6]);
  });

  it("traces the same curve as the quadratic it came from", () => {
    // The real check: sample both parameterisations and compare. A wrong factor (1/2, 3/4) keeps
    // the endpoints and still fails here.
    const [x0, y0, cx, cy, x1, y1] = [10, 20, 40, 90, 70, 30];
    const c = quadToCubic(x0, y0, cx, cy, x1, y1);
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const u = 1 - t;
      const quad = [
        u * u * x0 + 2 * u * t * cx + t * t * x1,
        u * u * y0 + 2 * u * t * cy + t * t * y1,
      ];
      const cubic = [
        u ** 3 * x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t ** 3 * c.x,
        u ** 3 * y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t ** 3 * c.y,
      ];
      expect(cubic[0]).toBeCloseTo(quad[0], 10);
      expect(cubic[1]).toBeCloseTo(quad[1], 10);
    }
  });
});

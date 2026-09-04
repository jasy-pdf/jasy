import type { PathCommand } from "../ir/display-list.ts";

/**
 * Geometry helpers shared by everything that produces a `Path` IR node - today a colour glyph's
 * outline, next an SVG shape.
 *
 * PDF has no quadratic curve operator: `c` (cubic), `v` and `y` are all there is. TrueType outlines
 * are quadratic and so is SVG's `Q`/`T`, so both have to raise the degree, and there is exactly one
 * correct way to do it - hence one function rather than two copies that drift.
 */

/**
 * Raises a quadratic Bézier to the cubic PDF wants. A quadratic with control point `C` between `P0`
 * and `P1` is the cubic with controls `P0 + 2/3(C - P0)` and `P1 + 2/3(C - P1)` - an exact identity,
 * not an approximation, so nothing is lost.
 */
export function quadToCubic(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x: number,
  y: number,
): PathCommand {
  return {
    op: "c",
    x1: x0 + (2 / 3) * (cx - x0),
    y1: y0 + (2 / 3) * (cy - y0),
    x2: x + (2 / 3) * (cx - x),
    y2: y + (2 / 3) * (cy - y),
    x,
    y,
  };
}

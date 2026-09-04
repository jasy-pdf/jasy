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

/**
 * Applies an affine to every point of a command list, BAKING the transform into the coordinates.
 *
 * Normally a transform belongs in the graphics state, so a stroke scales with the drawing. A clip has
 * no stroke and is set from a path in the CURRENT space, so a `<clipPath>` whose children carry their
 * own `transform` has to have it folded in here instead.
 */
export function transformCommands(
  commands: readonly PathCommand[],
  [a, b, c, d, e, f]: readonly [number, number, number, number, number, number],
): PathCommand[] {
  const mx = (x: number, y: number) => a * x + c * y + e;
  const my = (x: number, y: number) => b * x + d * y + f;
  return commands.map((cmd) => {
    if (cmd.op === "z") return cmd;
    if (cmd.op === "c") {
      return {
        op: "c" as const,
        x1: mx(cmd.x1, cmd.y1),
        y1: my(cmd.x1, cmd.y1),
        x2: mx(cmd.x2, cmd.y2),
        y2: my(cmd.x2, cmd.y2),
        x: mx(cmd.x, cmd.y),
        y: my(cmd.x, cmd.y),
      };
    }
    return { op: cmd.op, x: mx(cmd.x, cmd.y), y: my(cmd.x, cmd.y) };
  });
}

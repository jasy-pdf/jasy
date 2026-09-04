import type { Affine } from "../utils/ttf-parser.ts";
import { SvgParseError } from "./errors.ts";

/**
 * The `transform` attribute. SVG's `matrix(a b c d e f)` is exactly the PDF `cm` operand and exactly
 * our IR's `TransformPush.matrix`, both read in a top-left, y-down space - so a transform maps across
 * with no sign flips. That is also why we keep transforms in the graphics state instead of baking them
 * into the coordinates: a stroke inside a scaled group scales WITH it, which is what SVG specifies.
 */

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** `a` then `b` - the matrix that applies `b` in the space `a` established. */
export function multiply(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export const isIdentity = (m: Affine): boolean => m.every((n, i) => n === IDENTITY[i]);

const TRANSFORM = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
const radians = (deg: number) => (deg * Math.PI) / 180;

/** Numbers in an SVG list: separated by commas, whitespace, or nothing at all before a minus sign. */
function numbers(list: string): number[] {
  const found = list.match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
  return found ? found.map(Number) : [];
}

/** Parses a whole `transform` attribute; several functions compose left to right, as in SVG. */
export function parseTransform(value: string): Affine {
  let out = IDENTITY;
  TRANSFORM.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TRANSFORM.exec(value)) !== null) {
    out = multiply(out, single(match[1]!, numbers(match[2]!)));
  }
  return out;
}

function single(name: string, a: number[]): Affine {
  switch (name) {
    case "matrix":
      if (a.length < 6) throw new SvgParseError(`transform: matrix() needs six numbers`);
      return [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!];
    case "translate":
      return [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    case "scale": {
      const sx = a[0] ?? 1;
      // One number scales both axes - the SVG rule, and a common source of squashed logos if missed.
      return [sx, 0, 0, a[1] ?? sx, 0, 0];
    }
    case "rotate": {
      const t = radians(a[0] ?? 0);
      const [cos, sin] = [Math.cos(t), Math.sin(t)];
      const r: Affine = [cos, sin, -sin, cos, 0, 0];
      if (a.length < 3) return r;
      // rotate(angle cx cy) = translate(cx,cy) rotate(angle) translate(-cx,-cy).
      const [cx, cy] = [a[1]!, a[2]!];
      return multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
    }
    case "skewX":
      return [1, 0, Math.tan(radians(a[0] ?? 0)), 1, 0, 0];
    case "skewY":
      return [1, Math.tan(radians(a[0] ?? 0)), 0, 1, 0, 0];
    default:
      throw new SvgParseError(`transform: unknown function "${name}()"`);
  }
}

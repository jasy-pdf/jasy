import svgpath from "svgpath";
import type { PathCommand } from "../ir/display-list.ts";
import { quadToCubic } from "../vector/path.ts";
import { SvgParseError } from "./errors.ts";
import type { Attributes } from "./style.ts";
import { length } from "./units.ts";

/**
 * Every drawable SVG shape becomes one list of path commands, so the rest of the pipeline knows about
 * exactly one kind of geometry. A rect is a path, a circle is four arcs, `<path>` is a path already.
 *
 * The `d` grammar - relative coordinates, the `S`/`T` shorthands, and elliptical arcs - is handled by
 * `svgpath`: `.abs().unshort().unarc()` leaves only M/L/H/V/C/Q/Z. Arcs are the reason: converting one
 * to Béziers is the SVG spec's own appendix, and a subtly wrong version looks ALMOST right.
 */

const num = (attributes: Attributes, name: string, fallback = 0): number =>
  length(attributes[name], `the "${name}" attribute`, fallback);

/** Four cubic arcs approximating a full ellipse. The constant is the standard circle-to-Bézier one. */
const KAPPA = 0.5522847498307936;

function ellipse(cx: number, cy: number, rx: number, ry: number): PathCommand[] {
  if (rx <= 0 || ry <= 0) return [];
  const [ox, oy] = [rx * KAPPA, ry * KAPPA];
  return [
    { op: "m", x: cx - rx, y: cy },
    { op: "c", x1: cx - rx, y1: cy - oy, x2: cx - ox, y2: cy - ry, x: cx, y: cy - ry },
    { op: "c", x1: cx + ox, y1: cy - ry, x2: cx + rx, y2: cy - oy, x: cx + rx, y: cy },
    { op: "c", x1: cx + rx, y1: cy + oy, x2: cx + ox, y2: cy + ry, x: cx, y: cy + ry },
    { op: "c", x1: cx - ox, y1: cy + ry, x2: cx - rx, y2: cy + oy, x: cx - rx, y: cy },
    { op: "z" },
  ];
}

function rect(attributes: Attributes): PathCommand[] {
  const [x, y] = [num(attributes, "x"), num(attributes, "y")];
  const [w, h] = [num(attributes, "width"), num(attributes, "height")];
  if (w <= 0 || h <= 0) return [];
  // An `rx` alone implies the same `ry`, and vice versa; both clamp to half the side.
  const rxRaw = attributes["rx"] !== undefined ? num(attributes, "rx") : num(attributes, "ry");
  const ryRaw = attributes["ry"] !== undefined ? num(attributes, "ry") : rxRaw;
  const rx = Math.min(rxRaw, w / 2);
  const ry = Math.min(ryRaw, h / 2);
  if (rx <= 0 || ry <= 0) {
    return [
      { op: "m", x, y },
      { op: "l", x: x + w, y },
      { op: "l", x: x + w, y: y + h },
      { op: "l", x, y: y + h },
      { op: "z" },
    ];
  }
  const [ox, oy] = [rx * KAPPA, ry * KAPPA];
  return [
    { op: "m", x: x + rx, y },
    { op: "l", x: x + w - rx, y },
    { op: "c", x1: x + w - rx + ox, y1: y, x2: x + w, y2: y + ry - oy, x: x + w, y: y + ry },
    { op: "l", x: x + w, y: y + h - ry },
    {
      op: "c",
      x1: x + w,
      y1: y + h - ry + oy,
      x2: x + w - rx + ox,
      y2: y + h,
      x: x + w - rx,
      y: y + h,
    },
    { op: "l", x: x + rx, y: y + h },
    { op: "c", x1: x + rx - ox, y1: y + h, x2: x, y2: y + h - ry + oy, x, y: y + h - ry },
    { op: "l", x, y: y + ry },
    { op: "c", x1: x, y1: y + ry - oy, x2: x + rx - ox, y2: y, x: x + rx, y },
    { op: "z" },
  ];
}

function points(value: string | number | undefined): [number, number][] {
  const found = String(value ?? "").match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
  const out: [number, number][] = [];
  for (let i = 0; found && i + 1 < found.length; i += 2) {
    out.push([Number(found[i]), Number(found[i + 1])]);
  }
  return out;
}

function polyline(value: string | number | undefined, close: boolean): PathCommand[] {
  const list = points(value);
  if (list.length === 0) return [];
  const out: PathCommand[] = [{ op: "m", x: list[0]![0], y: list[0]![1] }];
  for (const [x, y] of list.slice(1)) out.push({ op: "l", x, y });
  if (close) out.push({ op: "z" });
  return out;
}

/** `d` through svgpath, then the remaining segment kinds mapped onto the IR's m/l/c/z. */
export function pathData(d: string): PathCommand[] {
  const out: PathCommand[] = [];
  let [cx, cy] = [0, 0];
  let [startX, startY] = [0, 0];
  try {
    const parsed = svgpath(d);
    // svgpath REPORTS a malformed `d` on the instance instead of throwing, so an unchecked call
    // quietly yields an empty path - the shape simply disappears.
    // Its bundled types omit `err`, though it IS the API: svgpath never throws on malformed input,
    // it records the reason and yields no segments - so the shape would just disappear.
    const err = (parsed as unknown as { err?: string }).err;
    if (err) throw new SvgParseError(`path data could not be read: ${err}`);
    parsed
      .abs()
      .unshort()
      .unarc()
      .iterate((segment) => {
        const [op, ...a] = segment as [string, ...number[]];
        switch (op) {
          case "M":
            [cx, cy] = [a[0]!, a[1]!];
            [startX, startY] = [cx, cy];
            out.push({ op: "m", x: cx, y: cy });
            break;
          case "L":
            [cx, cy] = [a[0]!, a[1]!];
            out.push({ op: "l", x: cx, y: cy });
            break;
          case "H":
            cx = a[0]!;
            out.push({ op: "l", x: cx, y: cy });
            break;
          case "V":
            cy = a[0]!;
            out.push({ op: "l", x: cx, y: cy });
            break;
          case "C":
            out.push({ op: "c", x1: a[0]!, y1: a[1]!, x2: a[2]!, y2: a[3]!, x: a[4]!, y: a[5]! });
            [cx, cy] = [a[4]!, a[5]!];
            break;
          case "Q":
            // PDF has no quadratic operator; the same conversion a TrueType outline needs.
            out.push(quadToCubic(cx, cy, a[0]!, a[1]!, a[2]!, a[3]!));
            [cx, cy] = [a[2]!, a[3]!];
            break;
          case "Z":
            out.push({ op: "z" });
            [cx, cy] = [startX, startY];
            break;
          default:
            throw new SvgParseError(`path data: unexpected segment "${op}"`);
        }
      });
  } catch (error) {
    if (error instanceof SvgParseError) throw error;
    throw new SvgParseError(`path data could not be read: ${(error as Error).message}`);
  }
  return out;
}

/** The geometry of one shape element, or null if the tag is not a shape. */
export function shapeOf(tagName: string, attributes: Attributes): PathCommand[] | null {
  switch (tagName) {
    case "path":
      return attributes["d"] ? pathData(String(attributes["d"])) : [];
    case "rect":
      return rect(attributes);
    case "circle": {
      const r = num(attributes, "r");
      return ellipse(num(attributes, "cx"), num(attributes, "cy"), r, r);
    }
    case "ellipse":
      return ellipse(
        num(attributes, "cx"),
        num(attributes, "cy"),
        num(attributes, "rx"),
        num(attributes, "ry"),
      );
    case "line":
      return [
        { op: "m", x: num(attributes, "x1"), y: num(attributes, "y1") },
        { op: "l", x: num(attributes, "x2"), y: num(attributes, "y2") },
      ];
    case "polyline":
      return polyline(attributes["points"], false);
    case "polygon":
      return polyline(attributes["points"], true);
    default:
      return null;
  }
}

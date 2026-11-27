import type { Color } from "../common/color.ts";
import type { SideBorders } from "../elements/rectangle-element.ts";
import {
  clampRadii,
  isRounded,
  type Line,
  type Path,
  type PathCommand,
  type Radii,
} from "../ir/display-list.ts";

type Point = { x: number; y: number };

/** A quarter ellipse: its radii and the point at angle t. */
interface Ellipse {
  rx: number;
  ry: number;
  at: (t: number) => Point;
}

/** One corner of the band a border paints, as the outer and inner edge of that band see it. */
interface Corner {
  /** The quarter of the ellipse this corner uses, clockwise (y-down angles). */
  from: number;
  to: number;
  outer: Ellipse;
  inner: Ellipse;
  /** Where the side before and the side after this corner meet, on the outer and the inner edge. */
  split: { outer: number; inner: number };
  rounded: boolean;
}

/**
 * The borders of a box whose sides are set one by one (top-left coordinates). A sharp box gets one
 * line per side. A rounded one gets the band each side paints, as CSS draws it: the band is the
 * border's stroke (centered on the box edge, like a uniform border), two sides meet on the line from
 * the band's outer corner to its inner one - the diagonal between two set sides, so a side next to
 * an unset one runs round the whole corner and tapers out. Sides of one color are one shape, so no
 * seam shows where they meet.
 */
export function sideBorderNodes(
  x: number,
  y: number,
  width: number,
  height: number,
  strokeWidth: number,
  sides: SideBorders,
  radius: number | Radii | undefined,
): (Line | Path)[] {
  if (!isRounded(radius)) return sideLines(x, y, width, height, strokeWidth, sides);

  const r = clampRadii(radius!, width, height);
  const half = (c?: Color) => (c ? strokeWidth / 2 : 0);
  const [top, right, bottom, left] = [sides.top, sides.right, sides.bottom, sides.left].map(half);
  const q = Math.PI / 2;
  // Clockwise from the top-left; corner i is the one BEFORE side i (top, right, bottom, left).
  const specs = [
    { k: { x, y }, sx: -1, sy: -1, r: r.tl, v: left!, h: top!, from: 2 * q },
    { k: { x: x + width, y }, sx: 1, sy: -1, r: r.tr, v: right!, h: top!, from: 3 * q },
    { k: { x: x + width, y: y + height }, sx: 1, sy: 1, r: r.br, v: right!, h: bottom!, from: 0 },
    { k: { x, y: y + height }, sx: -1, sy: 1, r: r.bl, v: left!, h: bottom!, from: q },
  ];
  // The inner edge is a rounded box of its own: each radius shrinks by the band (CSS's inner radius,
  // 0 where it runs out), and the set is clamped to the inner box as the outer one is to the box -
  // else a large corner runs past the inner box and the even-odd fill cuts into the straight sides.
  const innerW = width - left! - right!;
  const innerH = height - top! - bottom!;
  const inner = specs.map((c) => ({
    x: c.r > 0 ? Math.max(0, c.r - c.v) : 0,
    y: c.r > 0 ? Math.max(0, c.r - c.h) : 0,
  }));
  const [itl, itr, ibr, ibl] = inner as [Point, Point, Point, Point];
  const ratio = (extent: number, a: number, b: number) =>
    a + b > 0 ? Math.max(0, extent) / (a + b) : Infinity;
  const scale = Math.min(
    1,
    ratio(innerW, itl.x, itr.x),
    ratio(innerW, ibl.x, ibr.x),
    ratio(innerH, itl.y, ibl.y),
    ratio(innerH, itr.y, ibr.y),
  );
  const corners = specs.map((c, i) =>
    corner(c.k, c.sx, c.sy, c.r, c.v, c.h, c.from, {
      x: inner[i]!.x * scale,
      y: inner[i]!.y * scale,
    }),
  );
  const colors = [sides.top, sides.right, sides.bottom, sides.left];

  const same = (a?: Color, b?: Color) =>
    !!a && !!b && a.toPDFColorString() === b.toPDFColorString() && a.getAlpha() === b.getAlpha();
  const fill = (color: Color, commands: PathCommand[]): Path => ({
    type: "path",
    commands,
    fill: color,
    fillRule: "evenodd",
  });

  // One color all round: the band is a ring - the outer edge, then the inner one as a hole. A band
  // that fills the whole box has no hole.
  if (colors.every((c) => same(c, colors[0]))) {
    const ring = (edge: "outer" | "inner"): PathCommand[] => {
      const p = corners[0]![edge].at(corners[0]!.to);
      const cmds: PathCommand[] = [{ op: "m", x: p.x, y: p.y }];
      for (let i = 1; i <= 4; i++) {
        const c = corners[i % 4]!;
        cmds.push(lineTo(c[edge].at(c.from)), ...arc(c, edge, c.from, c.to));
      }
      return [...cmds, { op: "z" }];
    };
    const hole = innerW > 0 && innerH > 0 ? ring("inner") : [];
    return [fill(colors[0]!, [...ring("outer"), ...hole])];
  }

  // Runs of sides in one color; a run starts where the side before it is unset or another color.
  const start = colors.findIndex((c, i) => !same(colors[(i + 3) % 4], c));
  const paths: Path[] = [];
  for (let i = 0; i < 4; ) {
    const first = (start + i) % 4;
    const color = colors[first];
    let n = 1;
    while (i + n < 4 && same(colors[(first + n) % 4], color)) n++;
    i += n;
    if (!color) continue;

    const head = corners[first]!;
    const tail = corners[(first + n) % 4]!;
    const p = head.outer.at(head.split.outer);
    const cmds: PathCommand[] = [
      { op: "m", x: p.x, y: p.y },
      ...arc(head, "outer", head.split.outer, head.to),
    ];
    // Out along the outer edge: corners inside the run are turned whole.
    for (let k = 1; k < n; k++) {
      const c = corners[(first + k) % 4]!;
      cmds.push(lineTo(c.outer.at(c.from)), ...arc(c, "outer", c.from, c.to));
    }
    cmds.push(lineTo(tail.outer.at(tail.from)), ...arc(tail, "outer", tail.from, tail.split.outer));
    // Across the split, and back along the inner edge.
    cmds.push(
      lineTo(tail.inner.at(tail.split.inner)),
      ...arc(tail, "inner", tail.split.inner, tail.from),
    );
    for (let k = n - 1; k >= 1; k--) {
      const c = corners[(first + k) % 4]!;
      cmds.push(lineTo(c.inner.at(c.to)), ...arc(c, "inner", c.to, c.from));
    }
    cmds.push(lineTo(head.inner.at(head.to)), ...arc(head, "inner", head.to, head.split.inner));
    paths.push(fill(color, [...cmds, { op: "z" }]));
  }
  return paths;
}

/**
 * The corner at box point `k`, `sx`/`sy` pointing out of the box (-1 left/top, 1 right/bottom).
 * `v` and `h` are how far the band reaches out of (and into) the box on the vertical and the
 * horizontal side here - half the stroke, or 0 for an unset side. `from` is where its quarter starts;
 * `innerRadius` the inner edge's radii, already clamped.
 */
function corner(
  k: Point,
  sx: number,
  sy: number,
  r: number,
  v: number,
  h: number,
  from: number,
  innerRadius: Point,
): Corner {
  const rounded = r > 0;
  // Outer edge: the radius grows by the band, round the same center.
  const out = { x: k.x + sx * v, y: k.y + sy * h };
  const inn = { x: k.x - sx * v, y: k.y - sy * h };
  const ox = rounded ? r + v : 0;
  const oy = rounded ? r + h : 0;
  const ellipse = (corner: Point, rx: number, ry: number): Ellipse => {
    const cx = corner.x - sx * rx;
    const cy = corner.y - sy * ry;
    return { rx, ry, at: (t) => ({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) }) };
  };
  const outer = ellipse(out, ox, oy);
  const inner = ellipse(inn, innerRadius.x, innerRadius.y);
  const to = from + Math.PI / 2;
  // The two sides meet on the line from the band's outer corner to its inner one.
  const onSplit = (p: Point) => (inn.x - out.x) * (p.y - out.y) - (inn.y - out.y) * (p.x - out.x);
  return {
    from,
    to,
    outer,
    inner,
    split: {
      outer: solve(from, to, (t) => onSplit(outer.at(t))),
      inner: solve(from, to, (t) => onSplit(inner.at(t))),
    },
    rounded,
  };
}

/** The angle in [a, b] where `f` crosses zero (bisection); an end when it does not cross. */
function solve(a: number, b: number, f: (t: number) => number): number {
  let fa = f(a);
  const fb = f(b);
  if (fa === 0 || fa * fb > 0) return Math.abs(fa) <= Math.abs(fb) ? a : b;
  for (let i = 0; i < 52; i++) {
    const m = (a + b) / 2;
    const fm = f(m);
    if (fa * fm <= 0) b = m;
    else {
      a = m;
      fa = fm;
    }
  }
  return (a + b) / 2;
}

function lineTo(p: Point): PathCommand {
  return { op: "l", x: p.x, y: p.y };
}

/** The corner's outer or inner edge from angle t0 to t1 (at most a quarter): one cubic, or none. */
function arc(corner: Corner, edge: "outer" | "inner", t0: number, t1: number): PathCommand[] {
  if (!corner.rounded || t0 === t1) return [];
  const { rx, ry, at } = corner[edge];
  const p0 = at(t0);
  const p3 = at(t1);
  const k = (4 / 3) * Math.tan((t1 - t0) / 4);
  return [
    {
      op: "c",
      x1: p0.x - k * rx * Math.sin(t0),
      y1: p0.y + k * ry * Math.cos(t0),
      x2: p3.x + k * rx * Math.sin(t1),
      y2: p3.y - k * ry * Math.cos(t1),
      x: p3.x,
      y: p3.y,
    },
  ];
}

/** One line per present side, along the box edges - the sharp case, as cells draw a grid. */
function sideLines(
  x: number,
  y: number,
  width: number,
  height: number,
  strokeWidth: number,
  sides: SideBorders,
): Line[] {
  const lines: Line[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number, stroke?: Color) => {
    if (stroke) lines.push({ type: "line", x1, y1, x2, y2, stroke, strokeWidth });
  };
  add(x, y, x + width, y, sides.top);
  add(x, y + height, x + width, y + height, sides.bottom);
  add(x, y, x, y + height, sides.left);
  add(x + width, y, x + width, y + height, sides.right);
  return lines;
}

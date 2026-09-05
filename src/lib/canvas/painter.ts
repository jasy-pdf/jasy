import { Color } from "../common/color.ts";
import { toColor, type ColorInput } from "../api/color.ts";
import { isGradientInput, resolveGradient, type GradientInput } from "../api/gradient.ts";
import type { Gradient, IRNode, PathCommand, StrokeStyle } from "../ir/display-list.ts";
import { pathData } from "../svg/shapes.ts";
import { boundsOf, quadToCubic } from "../vector/path.ts";

/**
 * The imperative escape hatch: a box in the layout that you draw into yourself.
 *
 * It is the SECOND producer of the vector layer (SVG is the first), so it needs no new IR and no
 * backend change - everything it draws is a `Path` node like any other, which means it tags, it
 * paginates, and it works in the browser.
 *
 * Three deliberate departures from the PDFKit-shaped painters (react-pdf's included):
 *
 * 1. **Typed to the value.** `cap: "round"` autocompletes and a wrong one is a compile error, where
 *    react-pdf's `paint` callback receives `painter: any` - no help on the one thing you use.
 * 2. **No hidden state.** There is no `lineWidth(2)` that a later `stroke()` happens to pick up, and
 *    no `save()`/`restore()` pair to forget: a transform or a clip is a SCOPE (`group`, `clipped`)
 *    that closes itself.
 * 3. **One coordinate system.** Top-left, y down, points - the same as every other element in jasy
 *    and the same as SVG. The origin is the canvas box, so `0,0` is its own corner.
 */

/** Where a shape ends up. A gradient resolves against the shape's own bounding box, as in SVG. */
export type PaintInput = ColorInput | GradientInput;

export interface StrokeOptions {
  /** Line width in points. Default 1. */
  width?: number;
  cap?: StrokeStyle["cap"];
  join?: StrokeStyle["join"];
  miterLimit?: number;
  /** Dash lengths in points, plus the phase to start at. */
  dash?: number[];
  dashOffset?: number;
}

export interface FillOptions {
  /** `evenodd` cuts a hole where subpaths overlap an odd number of times. Default `nonzero`. */
  rule?: "nonzero" | "evenodd";
}

/** A transform applied for the duration of a `group`. Composed in this order: translate, rotate, scale. */
export interface TransformOptions {
  translate?: [number, number];
  /** Degrees, clockwise on the page. */
  rotate?: number;
  /** One number scales both axes. */
  scale?: number | [number, number];
  /** The point `rotate` and `scale` happen around. Default `[0, 0]`. */
  origin?: [number, number];
}

/** The size the callback was given, so a drawing can be written relative to its box. */
export interface CanvasSize {
  width: number;
  height: number;
}

const DEGREES = Math.PI / 180;

export class CanvasPainter {
  /** The nodes drawn so far, in order. */
  private readonly nodes: IRNode[] = [];
  /** The path being built. Emptied by every painting call, so a shape cannot leak into the next. */
  private current: PathCommand[] = [];
  private cursor: [number, number] = [0, 0];
  private start: [number, number] = [0, 0];

  constructor(readonly size: CanvasSize) {}

  /** Everything drawn, for the renderer. */
  drawn(): IRNode[] {
    return this.nodes;
  }

  // --- building a path ---------------------------------------------------------------------------

  move(x: number, y: number): this {
    this.current.push({ op: "m", x, y });
    this.cursor = [x, y];
    this.start = [x, y];
    return this;
  }

  line(x: number, y: number): this {
    this.current.push({ op: "l", x, y });
    this.cursor = [x, y];
    return this;
  }

  /** A cubic Bézier - the curve PDF draws natively. */
  curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.current.push({ op: "c", x1, y1, x2, y2, x, y });
    this.cursor = [x, y];
    return this;
  }

  /** A quadratic Bézier. PDF has no operator for one, so it is raised to a cubic exactly. */
  quad(cx: number, cy: number, x: number, y: number): this {
    this.current.push(quadToCubic(this.cursor[0], this.cursor[1], cx, cy, x, y));
    this.cursor = [x, y];
    return this;
  }

  close(): this {
    this.current.push({ op: "z" });
    this.cursor = [...this.start];
    return this;
  }

  rect(x: number, y: number, width: number, height: number): this {
    return this.move(x, y)
      .line(x + width, y)
      .line(x + width, y + height)
      .line(x, y + height)
      .close();
  }

  circle(cx: number, cy: number, r: number): this {
    return this.ellipse(cx, cy, r, r);
  }

  /** Four cubics; the constant is the standard circle-to-Bézier one. */
  ellipse(cx: number, cy: number, rx: number, ry: number): this {
    const k = 0.5522847498307936;
    const [ox, oy] = [rx * k, ry * k];
    return this.move(cx - rx, cy)
      .curve(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry)
      .curve(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy)
      .curve(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry)
      .curve(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy)
      .close();
  }

  polygon(points: readonly (readonly [number, number])[]): this {
    if (points.length === 0) return this;
    this.move(points[0]![0], points[0]![1]);
    for (const [x, y] of points.slice(1)) this.line(x, y);
    return this.close();
  }

  /** SVG path data, through the same reader `Svg()` uses - arcs and shorthands included. */
  path(d: string): this {
    const parsed = pathData(d);
    this.current.push(...parsed);
    // Where the pen ends up: after a `z` it is back at that subpath's `m`, not at the last point.
    for (const cmd of parsed) {
      if (cmd.op === "m") this.start = [cmd.x, cmd.y];
      this.cursor = cmd.op === "z" ? [...this.start] : [cmd.x, cmd.y];
    }
    return this;
  }

  // --- painting it -------------------------------------------------------------------------------

  /** Fills the path built so far and starts a new one. Default black, as in SVG and PDF. */
  fill(paint: PaintInput = "black", options: FillOptions = {}): this {
    return this.paint(this.resolve(paint), undefined, options.rule);
  }

  /** Strokes the path built so far and starts a new one. */
  stroke(color: ColorInput = "black", options: StrokeOptions = {}): this {
    return this.paint(undefined, this.strokeStyle(color, options));
  }

  fillAndStroke(
    paint: PaintInput,
    color: ColorInput,
    options: StrokeOptions & FillOptions = {},
  ): this {
    return this.paint(this.resolve(paint), this.strokeStyle(color, options), options.rule);
  }

  // --- scopes, instead of save/restore -----------------------------------------------------------

  /**
   * Draws inside a transform. It closes itself, so there is no `restore()` to forget - and a nested
   * `group` composes, exactly like a `<g transform>` in SVG.
   */
  group(transform: TransformOptions, draw: (c: CanvasPainter) => void): this {
    this.assertNoPendingPath("group");
    const matrix = this.matrixOf(transform);
    this.nodes.push({ type: "transform-push", matrix });
    draw(this);
    this.assertNoPendingPath("group");
    this.nodes.push({ type: "transform-pop" });
    return this;
  }

  /**
   * Draws clipped to a path. `build` draws the clip shape (nothing is painted from it), `draw` draws
   * what the clip applies to.
   */
  clipped(
    build: (c: CanvasPainter) => void,
    draw: (c: CanvasPainter) => void,
    options: FillOptions = {},
  ): this {
    this.assertNoPendingPath("clipped");
    build(this);
    const commands = this.current;
    this.current = [];
    this.nodes.push({ type: "clip-path-push", commands, fillRule: options.rule });
    draw(this);
    this.assertNoPendingPath("clipped");
    this.nodes.push({ type: "clip-pop" });
    return this;
  }

  // --- internals ---------------------------------------------------------------------------------

  private paint(
    fill: Color | Gradient | undefined,
    stroke: StrokeStyle | undefined,
    rule?: FillOptions["rule"],
  ): this {
    const commands = this.current;
    this.current = [];
    if (commands.length === 0) return this;
    this.nodes.push({ type: "path", commands, fill, fillRule: rule, stroke });
    return this;
  }

  /**
   * A path may not cross the edge of a scope. It would be built in one coordinate space and painted
   * in another, and the version that just dropped it made a shape vanish without a word - exactly
   * the silence this codebase refuses everywhere else.
   */
  private assertNoPendingPath(scope: string): void {
    if (this.current.length === 0) return;
    this.current = [];
    throw new Error(
      `@jasy/pdf: a Canvas path was built but never filled or stroked around \`${scope}()\`. ` +
        `Paint it before the scope opens, or move the drawing inside it.`,
    );
  }

  private resolve(paint: PaintInput): Color | Gradient {
    if (isGradientInput(paint)) {
      const box = boundsOf(this.current);
      return resolveGradient(paint, box.x, box.y, box.width, box.height);
    }
    return toColor(paint);
  }

  private strokeStyle(color: ColorInput, options: StrokeOptions): StrokeStyle {
    return {
      color: toColor(color),
      width: options.width ?? 1,
      cap: options.cap,
      join: options.join,
      miterLimit: options.miterLimit,
      dash: options.dash,
      dashOffset: options.dashOffset,
    };
  }

  private matrixOf(t: TransformOptions): [number, number, number, number, number, number] {
    const [ox, oy] = t.origin ?? [0, 0];
    const [sx, sy] = Array.isArray(t.scale) ? t.scale : [t.scale ?? 1, t.scale ?? 1];
    const theta = (t.rotate ?? 0) * DEGREES;
    const [cos, sin] = [Math.cos(theta), Math.sin(theta)];
    // T(translate) · T(origin) · R · S · T(-origin), written out as a PDF `cm` operand.
    const [a, b, c, d] = [cos * sx, sin * sx, -sin * sy, cos * sy];
    const [tx, ty] = t.translate ?? [0, 0];
    // `-sin(0)` is -0, which is a surprising value to read back out of a matrix. It writes as
    // "0.000" either way, so normalising costs nothing and keeps the number predictable.
    const zero = (n: number): number => (n === 0 ? 0 : n);
    return [a, b, c, d, tx + ox - (a * ox + c * oy), ty + oy - (b * ox + d * oy)].map(zero) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
  }
}

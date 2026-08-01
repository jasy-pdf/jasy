import { toColor, type ColorInput } from "./color.ts";
import type { Gradient, GradientStop } from "../ir/display-list.ts";

/**
 * Gradients for a box background.
 *
 * The public form is BOX-RELATIVE - an angle and some stops - because that is what an author knows
 * when writing the document. The engine's `Gradient` wants absolute page coordinates, so the renderer
 * resolves one against the box it is painting; see `resolveGradient`.
 */

/** A stop as written: a colour, optionally pinned to a position 0..1 along the axis. */
export type StopInput = ColorInput | { color: ColorInput; at: number };

export interface LinearGradientInput {
  kind: "linear";
  /** Direction in degrees, CSS convention: 0 = to the top, 90 = to the right (default 180, downwards). */
  angle: number;
  stops: StopInput[];
}

export interface RadialGradientInput {
  kind: "radial";
  /** Centre as a fraction of the box, `[0.5, 0.5]` being the middle (the default). */
  center: [number, number];
  /** Outer radius as a fraction of the box's larger side (default 0.5, i.e. it touches the edges). */
  radius: number;
  stops: StopInput[];
}

export type GradientInput = LinearGradientInput | RadialGradientInput;

export const isGradientInput = (v: unknown): v is GradientInput =>
  typeof v === "object" && v !== null && "kind" in v && "stops" in v;

/**
 * A linear gradient. `linearGradient("#fff", "#000")` runs top to bottom; pass `{ angle }` for any
 * other direction, and `{ color, at }` for a stop that is not evenly spaced.
 */
export function linearGradient(
  ...args: [...StopInput[]] | [{ angle?: number; stops: StopInput[] }]
): LinearGradientInput {
  const first = args[0];
  if (args.length === 1 && typeof first === "object" && first !== null && "stops" in first) {
    return { kind: "linear", angle: first.angle ?? 180, stops: first.stops };
  }
  return { kind: "linear", angle: 180, stops: args as StopInput[] };
}

/** A radial gradient, centred by default and reaching the edges. */
export function radialGradient(
  ...args: [...StopInput[]] | [{ center?: [number, number]; radius?: number; stops: StopInput[] }]
): RadialGradientInput {
  const first = args[0];
  if (args.length === 1 && typeof first === "object" && first !== null && "stops" in first) {
    return {
      kind: "radial",
      center: first.center ?? [0.5, 0.5],
      radius: first.radius ?? 0.5,
      stops: first.stops,
    };
  }
  return { kind: "radial", center: [0.5, 0.5], radius: 0.5, stops: args as StopInput[] };
}

/**
 * Spread the stops that carry no `at` evenly, first to last, the way CSS does - and check the pinned
 * ones, because they end up in a PDF stitching function's `/Bounds`, which the format requires to be
 * strictly increasing inside the domain. A bad offset there is not a wrong-looking gradient, it is a
 * malformed file, so it is refused by name here rather than emitted.
 */
function toStops(stops: StopInput[]): GradientStop[] {
  if (stops.length < 2) {
    throw new Error("A gradient needs at least two colour stops.");
  }
  const last = stops.length - 1;
  const out: GradientStop[] = stops.map((s, i) => {
    const pinned = typeof s === "object" && s !== null && "at" in s;
    const at = pinned ? (s as { at: number }).at : i / last;
    if (!Number.isFinite(at) || at < 0 || at > 1) {
      throw new Error(`Invalid gradient stop position ${at}: it must be a number between 0 and 1.`);
    }
    return {
      offset: at,
      color: toColor(pinned ? (s as { color: ColorInput }).color : (s as ColorInput)),
    };
  });

  for (let i = 1; i < out.length; i++) {
    if (out[i].offset <= out[i - 1].offset) {
      throw new Error(
        `Gradient stops must move forward: stop ${i} sits at ${out[i].offset}, which is not after ` +
          `${out[i - 1].offset}. (Two stops at the SAME position would be a hard colour edge in CSS; ` +
          `PDF cannot express that in one shading, so it is refused rather than drawn wrongly.)`,
      );
    }
  }

  // A pinned first or last stop would otherwise be IGNORED - the shading's domain is always 0..1 and
  // only the INTERIOR offsets reach /Bounds. Carrying the edge colour outwards is what CSS does.
  if (out[0].offset > 0) out.unshift({ offset: 0, color: out[0].color });
  if (out[out.length - 1].offset < 1) out.push({ offset: 1, color: out[out.length - 1].color });
  return out;
}

/**
 * Resolve a box-relative gradient against the box it paints, into the absolute page coordinates the
 * IR wants. Called by the renderer, which is the first place the box's geometry is known.
 *
 * The angle follows CSS: 0 points to the top and it turns clockwise, so 90 goes to the right. The
 * axis runs through the box centre and is scaled so it spans the box on that diagonal - which is why
 * a 45-degree gradient reaches the corners rather than stopping short of them.
 */
export function resolveGradient(
  g: GradientInput,
  x: number,
  y: number,
  width: number,
  height: number,
): Gradient {
  const stops = toStops(g.stops);
  if (g.kind === "radial") {
    const cx = x + g.center[0] * width;
    const cy = y + g.center[1] * height;
    const r = g.radius * Math.max(width, height);
    return { type: "radial", x0: cx, y0: cy, r0: 0, x1: cx, y1: cy, r1: r, stops, extend: "pad" };
  }
  const rad = ((g.angle % 360) * Math.PI) / 180;
  // CSS angles: 0 = up, clockwise. The engine lays out top-left down, so "up" is -y here.
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  // Half the box's extent along the axis, so the line covers the whole box for any angle.
  const half = (Math.abs(dx) * width + Math.abs(dy) * height) / 2;
  const cx = x + width / 2;
  const cy = y + height / 2;
  return {
    type: "linear",
    x0: cx - dx * half,
    y0: cy - dy * half,
    x1: cx + dx * half,
    y1: cy + dy * half,
    stops,
    extend: "pad",
  };
}

import type { Radii } from "../ir/display-list.ts";
import type { CrossAlign } from "../layout/alignment.ts";

/**
 * Size input for a Box's `width` / `height` (relative sizing). Either a number of PDF points (a
 * fixed size) or a percentage string like `"50%"` - a fraction of the space the parent offers on
 * that axis. Every form normalizes to a `Dimension` via `toDimension`, so the engine only ever sees
 * points and factors, never a string. A percentage resolves against the parent's offered extent, so
 * it only has meaning inside a bounded region (a fraction of an unbounded axis is a no-op).
 */
export type SizeInput = number | `${number}%`;

/** A resolved `SizeInput`: exactly one of an absolute point size or a 0..1 fraction of the parent. */
export interface Dimension {
  /** Absolute size in PDF points. */
  points?: number;
  /** Fraction of the parent's offered extent on this axis; a `"50%"` input is `0.5`. */
  factor?: number;
}

const PERCENT = /^(\d+(?:\.\d+)?)%$/; // no leading "-": a size cannot be negative

/**
 * Normalizes a `SizeInput` to a `Dimension` (a point size or a fraction). Rejects negatives at this
 * boundary so `resolveExtent` and the layout never see a negative size.
 */
export function toDimension(value: SizeInput): Dimension {
  if (typeof value === "number") {
    if (value < 0) throw new Error(`Invalid size ${value}: a size cannot be negative.`);
    return { points: value };
  }
  const m = PERCENT.exec(value.trim());
  if (m) return { factor: parseFloat(m[1]) / 100 };
  throw new Error(`Invalid size "${value}": use a number of points or a percentage like "50%".`);
}

/** The bound and ratio options every sized factory accepts, in the public `SizeInput` form. */
export interface BoundsInput {
  /**
   * This element's own cross-axis alignment inside its Column / Row (CSS `align-self`), overriding the
   * container's `align`. On a `Spacer` / `Expanded` it is a no-op - a flex child fills the main axis and
   * has no natural cross size to align.
   */
  alignSelf?: CrossAlign;
  minWidth?: SizeInput;
  maxWidth?: SizeInput;
  minHeight?: SizeInput;
  maxHeight?: SizeInput;
  /**
   * width / height (CSS `aspect-ratio`). Fills in whichever axis you leave open, and sizes the box
   * from the offered width when you leave both open. An explicit `min`/`max` still wins over it.
   */
  aspectRatio?: number;
}

/** Split `BoundsInput` into the points-and-factors form the elements take. */
export function toBounds(o: BoundsInput) {
  const d = (v: SizeInput | undefined) => (v !== undefined ? toDimension(v) : undefined);
  const [minW, maxW, minH, maxH] = [d(o.minWidth), d(o.maxWidth), d(o.minHeight), d(o.maxHeight)];
  if (o.aspectRatio !== undefined && !(o.aspectRatio > 0)) {
    throw new Error(
      `Invalid aspectRatio ${o.aspectRatio}: it is width / height and must be above 0.`,
    );
  }
  return {
    minWidth: minW?.points,
    maxWidth: maxW?.points,
    minHeight: minH?.points,
    maxHeight: maxH?.points,
    minWidthFactor: minW?.factor,
    maxWidthFactor: maxW?.factor,
    minHeightFactor: minH?.factor,
    maxHeightFactor: maxH?.factor,
    aspectRatio: o.aspectRatio,
  };
}

/**
 * Corner radius input. A single number rounds all four corners; the object names them; the tuple is
 * CSS order - `[topLeft, topRight, bottomRight, bottomLeft]`, clockwise from the top left.
 */
export type RadiusInput =
  | number
  | { topLeft?: number; topRight?: number; bottomRight?: number; bottomLeft?: number }
  | [number, number, number, number];

/** Normalizes a `RadiusInput` to the engine's short corner names. */
export function toRadius(r: RadiusInput): number | Radii {
  if (typeof r === "number") return r;
  if (Array.isArray(r)) return { tl: r[0], tr: r[1], br: r[2], bl: r[3] };
  return { tl: r.topLeft, tr: r.topRight, br: r.bottomRight, bl: r.bottomLeft };
}

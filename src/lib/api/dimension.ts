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

const PERCENT = /^(-?\d+(?:\.\d+)?)%$/;

/** Normalizes a `SizeInput` to a `Dimension` (a point size or a fraction). */
export function toDimension(value: SizeInput): Dimension {
  if (typeof value === "number") return { points: value };
  const m = PERCENT.exec(value.trim());
  if (m) return { factor: parseFloat(m[1]) / 100 };
  throw new Error(`Invalid size "${value}": use a number of points or a percentage like "50%".`);
}

/**
 * The size constraints handed DOWN the tree during layout (Flutter's BoxConstraints
 * model). Pure geometry: a min/max range per axis, no position. An element receives a
 * `BoxConstraints`, chooses a `Size` within it, and returns that size UP.
 *
 * `Infinity` means "unbounded" on that side - the element may be as large as it wants
 * and should size to its own content (e.g. text height, a shrink-wrapping padding).
 * A *tight* axis (`min === max`) forces an exact size; a *loose* axis (`min === 0`)
 * lets the element pick anything up to `max`.
 *
 * This is the contract the future fragmentation pass (roadmap Phase 5) reads: a page's
 * remaining vertical space becomes a `maxHeight`, and "does this fit?" is a constraint
 * check, not a special case.
 */
export class BoxConstraints {
  constructor(
    public readonly minWidth: number = 0,
    public readonly maxWidth: number = Infinity,
    public readonly minHeight: number = 0,
    public readonly maxHeight: number = Infinity,
  ) {}

  /** Forces an exact size: the element has no choice but `width` x `height`. */
  static tight(width: number, height: number): BoxConstraints {
    return new BoxConstraints(width, width, height, height);
  }

  /** Tight only on the axes given; the others stay unbounded (0..Infinity). */
  static tightFor({ width, height }: { width?: number; height?: number }): BoxConstraints {
    return new BoxConstraints(width ?? 0, width ?? Infinity, height ?? 0, height ?? Infinity);
  }

  /** Caps each axis at `max` but allows anything down to zero (shrink-wrap). */
  static loose(maxWidth: number, maxHeight: number): BoxConstraints {
    return new BoxConstraints(0, maxWidth, 0, maxHeight);
  }

  get hasBoundedWidth(): boolean {
    return this.maxWidth !== Infinity;
  }

  get hasBoundedHeight(): boolean {
    return this.maxHeight !== Infinity;
  }

  get isTight(): boolean {
    return this.minWidth === this.maxWidth && this.minHeight === this.maxHeight;
  }

  /** Clamps a desired width into [minWidth, maxWidth]. */
  constrainWidth(width: number = Infinity): number {
    return Math.max(this.minWidth, Math.min(width, this.maxWidth));
  }

  /** Clamps a desired height into [minHeight, maxHeight]. */
  constrainHeight(height: number = Infinity): number {
    return Math.max(this.minHeight, Math.min(height, this.maxHeight));
  }

  /** Clamps a desired size into this box on both axes. */
  constrain(size: Size): Size {
    return {
      width: this.constrainWidth(size.width),
      height: this.constrainHeight(size.height),
    };
  }

  /**
   * Shrinks the box by `horizontal`/`vertical` on both bounds (never below zero) -
   * what a padding/border element hands its child after reserving its own insets.
   */
  deflate(horizontal: number, vertical: number): BoxConstraints {
    return new BoxConstraints(
      Math.max(0, this.minWidth - horizontal),
      Math.max(0, this.maxWidth - horizontal),
      Math.max(0, this.minHeight - vertical),
      Math.max(0, this.maxHeight - vertical),
    );
  }

  /**
   * Tightens this box by an element's own `min`/`max` on either axis. A max never widens the offered
   * room, and a min may push past it - `minHeight: 500` in a 300pt region means 500, and pagination
   * deals with the overflow, the same answer CSS gives.
   */
  narrow(
    minWidth?: number,
    maxWidth?: number,
    minHeight?: number,
    maxHeight?: number,
  ): BoxConstraints {
    const lo = (own: number | undefined, current: number) => Math.max(current, own ?? 0);
    const hi = (own: number | undefined, current: number) =>
      own === undefined ? current : Math.min(current, own);
    return new BoxConstraints(
      lo(minWidth, this.minWidth),
      Math.max(hi(maxWidth, this.maxWidth), lo(minWidth, this.minWidth)),
      lo(minHeight, this.minHeight),
      Math.max(hi(maxHeight, this.maxHeight), lo(minHeight, this.minHeight)),
    );
  }

  /** Returns the constraints clamped to lie within `parent` (Flutter's enforce). */
  enforce(parent: BoxConstraints): BoxConstraints {
    return new BoxConstraints(
      Math.max(parent.minWidth, Math.min(this.minWidth, parent.maxWidth)),
      Math.max(parent.minWidth, Math.min(this.maxWidth, parent.maxWidth)),
      Math.max(parent.minHeight, Math.min(this.minHeight, parent.maxHeight)),
      Math.max(parent.minHeight, Math.min(this.maxHeight, parent.maxHeight)),
    );
  }
}

/**
 * Resolves a sized element's extent on one axis (relative sizing). An explicit point size (`fixed`)
 * always wins; otherwise a `factor` (0..1) of the offered extent, but ONLY when that axis is bounded -
 * a fraction of an unbounded axis has no meaning (Flutter's FractionallySizedBox under unbounded
 * constraints). Returns `undefined` to mean "no explicit extent", i.e. fill the box or shrink-wrap.
 * Shared by every sized element so `width: "50%"` behaves identically across Box / Column / Row / Image.
 */
export function resolveExtent(
  fixed: number | undefined,
  factor: number | undefined,
  boundedMax: number,
  hasBounded: boolean,
): number | undefined {
  if (fixed !== undefined) return fixed;
  if (factor !== undefined && hasBounded) return boundedMax * factor;
  return undefined;
}

/** What one axis of a sized element was asked for: a size, plus the bounds it must stay inside. */
export interface ExtentSpec {
  fixed?: number;
  factor?: number;
  min?: number;
  minFactor?: number;
  max?: number;
  maxFactor?: number;
}

/** The sizing options every sized element accepts. Each `*Factor` is the percentage form of its pair. */
export interface SizingParams {
  width?: number;
  height?: number;
  widthFactor?: number;
  heightFactor?: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minWidthFactor?: number;
  maxWidthFactor?: number;
  minHeightFactor?: number;
  maxHeightFactor?: number;
  /** width / height. Derives whichever axis is left open; see `resolveSize`. */
  aspectRatio?: number;
}

/** Split `SizingParams` into the per-axis form `resolveSize` takes. */
export function extentSpecs(p: SizingParams): { width: ExtentSpec; height: ExtentSpec } {
  return {
    width: {
      fixed: p.width,
      factor: p.widthFactor,
      min: p.minWidth,
      minFactor: p.minWidthFactor,
      max: p.maxWidth,
      maxFactor: p.maxWidthFactor,
    },
    height: {
      fixed: p.height,
      factor: p.heightFactor,
      min: p.minHeight,
      minFactor: p.minHeightFactor,
      max: p.maxHeight,
      maxFactor: p.maxHeightFactor,
    },
  };
}

/**
 * Resolve both axes of a sized element: relative sizing, then `aspectRatio`, then `min`/`max`.
 *
 * The order follows CSS: a ratio fills in the axis you left open, and min/max clamp afterwards - so an
 * explicit bound wins over the ratio, exactly as `min-height` beats `aspect-ratio` in a browser.
 *
 * `min`/`max` also come back as NARROWED constraints, because an axis with no explicit size still has
 * to obey them. `maxWidth` alone means "fill, but no wider than this", and the caller's own fill and
 * shrink-wrap paths get that for free by using the returned constraints instead of the ones passed in.
 * A `width` of `undefined` keeps its usual meaning: fill or shrink-wrap.
 */
export function resolveSize(
  width: ExtentSpec,
  height: ExtentSpec,
  aspectRatio: number | undefined,
  constraints: BoxConstraints,
): { width?: number; height?: number; constraints: BoxConstraints } {
  const bounds = constraints.narrow(
    resolveExtent(width.min, width.minFactor, constraints.maxWidth, constraints.hasBoundedWidth),
    resolveExtent(width.max, width.maxFactor, constraints.maxWidth, constraints.hasBoundedWidth),
    resolveExtent(
      height.min,
      height.minFactor,
      constraints.maxHeight,
      constraints.hasBoundedHeight,
    ),
    resolveExtent(
      height.max,
      height.maxFactor,
      constraints.maxHeight,
      constraints.hasBoundedHeight,
    ),
  );

  let w = resolveExtent(width.fixed, width.factor, bounds.maxWidth, bounds.hasBoundedWidth);
  let h = resolveExtent(height.fixed, height.factor, bounds.maxHeight, bounds.hasBoundedHeight);

  if (aspectRatio !== undefined && aspectRatio > 0) {
    if (w !== undefined && h === undefined) h = w / aspectRatio;
    else if (h !== undefined && w === undefined) w = h * aspectRatio;
    else if (w === undefined && h === undefined) {
      // Neither axis pinned: take the offered width and let the ratio give the height (CSS block
      // behaviour). Falls back to the height when only that axis is bounded.
      if (bounds.hasBoundedWidth) {
        w = bounds.maxWidth;
        h = w / aspectRatio;
      } else if (bounds.hasBoundedHeight) {
        h = bounds.maxHeight;
        w = h * aspectRatio;
      }
    }
  }

  return {
    width: w === undefined ? undefined : bounds.constrainWidth(w),
    height: h === undefined ? undefined : bounds.constrainHeight(h),
    constraints: bounds,
  };
}

/** The size an element resolves to and returns UP the tree. */
export interface Size {
  width: number;
  height: number;
}

/** The absolute top-left position a parent assigns to a child (threaded DOWN). */
export interface Offset {
  x: number;
  y: number;
}

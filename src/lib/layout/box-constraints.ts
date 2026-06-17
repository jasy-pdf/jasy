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

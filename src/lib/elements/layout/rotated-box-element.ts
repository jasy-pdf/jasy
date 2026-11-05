import { PDFElement, LayoutContext } from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";

/**
 * Rotates its child by whole quarter-turns and, unlike `RotatedElement` (paint-only), makes the
 * rotation LAYOUT-AWARE: for a 90 / 270 turn it SWAPS width and height, so the box reports the rotated
 * footprint UP and siblings reflow around it. A tall text becomes a narrow vertical strip that actually
 * reserves its narrow width and its long height - the "vertical label beside a table" case.
 *
 * `turns` is the number of 90-degree CLOCKWISE quarter-turns (like Flutter's `RotatedBox.quarterTurns`):
 * 0 = none, 1 = 90, 2 = 180, 3 = 270. The child lays out with the box's constraints swapped, then it is
 * placed centered on the box's center so a plain center-rotation (the shared renderer) maps it exactly
 * onto the swapped box.
 */
export class RotatedBoxElement extends PDFElement {
  private turns: number; // normalized 0..3, clockwise
  private child: PDFElement;
  private x = 0;
  private y = 0;
  private width = 0;
  private height = 0;

  constructor({ turns, child }: { turns: number; child: PDFElement }) {
    super();
    this.turns = ((Math.trunc(turns) % 4) + 4) % 4;
    this.child = child;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    // Measure the child to learn its natural size, then take that size swapped as our own box.
    const child = this.child.measure(this.childConstraints(constraints), ctx);
    const size = this.swap(child);
    this.width = size.width;
    this.height = size.height;
    this.x = offset.x;
    this.y = offset.y;

    // Place the child CENTERED on the box center (relative to our top-left): a rotation around that
    // center then maps the child's (w x h) box exactly onto our (swapped) box - so the shared renderer
    // needs no special case.
    this.child.calculateLayout(
      this.childConstraints(constraints),
      { x: (this.width - child.width) / 2, y: (this.height - child.height) / 2 },
      ctx,
    );
    return size;
  }

  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    return this.swap(this.child.measure(this.childConstraints(constraints), ctx));
  }

  /** 90 or 270 degrees swap the axes: the child experiences the box's constraints turned. */
  private get quarter(): boolean {
    return this.turns % 2 === 1;
  }

  private childConstraints(constraints: BoxConstraints): BoxConstraints {
    return this.quarter
      ? new BoxConstraints(
          constraints.minHeight,
          constraints.maxHeight,
          constraints.minWidth,
          constraints.maxWidth,
        )
      : constraints;
  }

  private swap(child: Size): Size {
    return this.quarter ? { width: child.height, height: child.width } : child;
  }

  /** Same shape as `RotatedElement` (angle + box), so both share `RotatedRenderer`. */
  override layoutChildren(): readonly PDFElement[] {
    return [this.child];
  }

  override getProps() {
    return {
      angle: this.turns * 90,
      child: this.child,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }
}

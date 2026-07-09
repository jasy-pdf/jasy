import { PDFElement, LayoutContext } from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";

/**
 * Rotates its single child at PAINT time only (like Flutter's `Transform.rotate`): the child lays out
 * in its normal, axis-aligned box and the element reports that same box UP, so siblings never reflow
 * around the rotated shape. Only the drawing is rotated, around the box's center, by the renderer.
 *
 * Layout-transparent: it delegates `calculateLayout` to the child and just records the resulting box,
 * which the renderer needs as the pivot. Not `Fragmentable` on purpose - a rotated subtree is atomic
 * w.r.t. pagination (it moves whole to the next page rather than splitting mid-rotation).
 */
export class RotatedElement extends PDFElement {
  private angle: number; // degrees, clockwise as seen on the page
  private child: PDFElement;
  private x = 0;
  private y = 0;
  private width = 0;
  private height = 0;

  constructor({ angle, child }: { angle: number; child: PDFElement }) {
    super();
    this.angle = angle;
    this.child = child;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    // Delegate entirely to the child, then record its box (position + size) as our own - the
    // rotation does not change what space we take, only how the child is painted.
    const size = this.child.calculateLayout(constraints, offset, ctx);
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  override getProps() {
    return {
      angle: this.angle,
      child: this.child,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }
}

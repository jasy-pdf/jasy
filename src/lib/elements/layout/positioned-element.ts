import { BoxConstraints, Offset, Size } from "../../layout/box-constraints";
import { LayoutContext, PDFElement, WithChild } from "../pdf-element";

/** Offsets from the frame's box edges, in points. Negative lets the child poke outside. */
export interface PositionedInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

interface PositionedElementParams extends WithChild, PositionedInsets {}

/**
 * An out-of-flow child, placed relative to the nearest enclosing positioning frame (a `relative`
 * Box). It takes ZERO space in the normal flow - `calculateLayout` returns `Size(0,0)` and instead
 * registers a placement closure on the frame. The frame runs that closure once it knows its own
 * size, so `right`/`bottom` resolve against the final box and the child can overflow it (a negative
 * `top`/`left` makes it poke into / out of the corner, e.g. a badge or tab).
 *
 * With no frame in scope the element is a no-op (nothing is drawn) - `Positioned` only makes sense
 * inside a `relative` Box.
 */
export class PositionedElement extends PDFElement {
  private child: PDFElement;
  private insets: PositionedInsets;

  constructor({ child, top, right, bottom, left }: PositionedElementParams) {
    super();
    this.child = child;
    this.insets = { top, right, bottom, left };
  }

  calculateLayout(_constraints: BoxConstraints, _offset: Offset, ctx: LayoutContext): Size {
    // Defer to the frame: it calls back once it has sized itself. Out of flow either way.
    ctx.frame?.place.push((frame, frameCtx) => this.placeInFrame(frame, frameCtx));
    return { width: 0, height: 0 };
  }

  /** Lays the child out at the resolved position inside (or overflowing) the frame box. */
  private placeInFrame(frame: { origin: Offset; size: Size }, ctx: LayoutContext): void {
    const { top, right, bottom, left } = this.insets;

    // An axis is PINNED (stretched) only when BOTH of its insets are given; otherwise the child
    // shrink-wraps its content (unbounded), the CSS rule for an absolutely-positioned element.
    const width =
      left !== undefined && right !== undefined
        ? Math.max(0, frame.size.width - left - right)
        : Infinity;
    const height =
      top !== undefined && bottom !== undefined
        ? Math.max(0, frame.size.height - top - bottom)
        : Infinity;
    const constraints = BoxConstraints.loose(width, height);

    // Measure first (so right/bottom can resolve against the child's own size).
    const measured = this.child.calculateLayout(constraints, { x: 0, y: 0 }, ctx);

    let x = frame.origin.x + (left ?? 0);
    if (left === undefined && right !== undefined) {
      x = frame.origin.x + frame.size.width - measured.width - right;
    }
    let y = frame.origin.y + (top ?? 0);
    if (top === undefined && bottom !== undefined) {
      y = frame.origin.y + frame.size.height - measured.height - bottom;
    }

    // Place it for real at the resolved corner.
    this.child.calculateLayout(constraints, { x, y }, ctx);
  }

  override getProps(): WithChild {
    return { child: this.child };
  }
}

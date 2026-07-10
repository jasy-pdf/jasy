import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, PDFElement, WithChild } from "../pdf-element.ts";

/** A position anchor along one axis: `start` (left/top), `center`, or `end` (right/bottom). */
export type PositionAnchor = "start" | "center" | "end";

/**
 * How a `Positioned` child sits in its frame. Two ways, pick per axis:
 *  - EDGE pinning: `top`/`right`/`bottom`/`left` (points from that edge; negative pokes outside).
 *    Pinning BOTH sides of an axis stretches the child to fill between them.
 *  - ANCHOR + nudge: `h`/`v` anchor the child (start/center/end) and `x`/`y` nudge it from there
 *    (e.g. `{ h: "center", x: -10 }` = centered minus 10pt). The child shrink-wraps to its content.
 * An edge wins over an anchor on the same axis. With nothing set the child sits at the top-left.
 */
export interface PositionedInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  h?: PositionAnchor;
  v?: PositionAnchor;
  x?: number;
  y?: number;
}

interface PositionedElementParams extends WithChild, PositionedInsets {}

/**
 * An out-of-flow child, placed relative to the nearest enclosing positioning frame: a `relative`
 * Box, or failing that the page's content box. It takes ZERO space in the normal flow -
 * `calculateLayout` returns `Size(0,0)` and instead registers a placement closure on the frame. The
 * frame runs that closure once it knows its own size, so `right`/`bottom` resolve against the final
 * box and the child can overflow it (a negative `top`/`left` makes it poke into / out of the
 * corner, e.g. a badge or tab).
 *
 * Every page supplies a frame - header, footer and body alike - so within a document there is
 * always one. Outside of one we REFUSE rather than draw: the element used to fall through to its
 * child's default (0, 0), which is how a header watermark landed silently in the page corner
 * (ISSUE-4). Content that lands somewhere unasked is worse than content that does not render.
 */
export class PositionedElement extends PDFElement {
  private child: PDFElement;
  private insets: PositionedInsets;

  constructor({ child, top, right, bottom, left, h, v, x, y }: PositionedElementParams) {
    super();
    this.child = child;
    this.insets = { top, right, bottom, left, h, v, x, y };
  }

  calculateLayout(_constraints: BoxConstraints, _offset: Offset, ctx: LayoutContext): Size {
    if (!ctx.frame) {
      throw new Error(
        "Positioned found no positioning frame. It must sit inside a Page (header, footer or body) " +
          "or inside a Box({ relative: true }).",
      );
    }
    // Defer to the frame: it calls back once it has sized itself. Out of flow either way.
    ctx.frame.place.push((frame, frameCtx) => this.placeInFrame(frame, frameCtx));
    return { width: 0, height: 0 };
  }

  /** Lays the child out at the resolved position inside (or overflowing) the frame box. */
  private placeInFrame(frame: { origin: Offset; size: Size }, ctx: LayoutContext): void {
    const { top, right, bottom, left, h, v, x: nudgeX, y: nudgeY } = this.insets;

    // An axis is PINNED (stretched) only when BOTH of its EDGES are given; otherwise the child
    // shrink-wraps its content (unbounded), the CSS rule for an absolutely-positioned element. An
    // anchor never stretches - it positions a content-sized child.
    const width =
      left !== undefined && right !== undefined
        ? Math.max(0, frame.size.width - left - right)
        : Infinity;
    const height =
      top !== undefined && bottom !== undefined
        ? Math.max(0, frame.size.height - top - bottom)
        : Infinity;
    const constraints = BoxConstraints.loose(width, height);

    // Measure first (so end/center anchors and right/bottom edges resolve against the child's size).
    const measured = this.child.calculateLayout(constraints, { x: 0, y: 0 }, ctx);

    // Resolve one axis: a near-edge pins to origin, a far-edge pins to the far side; otherwise the
    // anchor (default `start`) positions the child and the nudge shifts it from there.
    const place = (
      origin: number,
      frameExtent: number,
      childExtent: number,
      nearEdge: number | undefined,
      farEdge: number | undefined,
      anchor: PositionAnchor | undefined,
      nudge: number | undefined,
    ): number => {
      if (nearEdge !== undefined) return origin + nearEdge;
      if (farEdge !== undefined) return origin + frameExtent - childExtent - farEdge;
      const base =
        anchor === "center"
          ? (frameExtent - childExtent) / 2
          : anchor === "end"
            ? frameExtent - childExtent
            : 0; // start (default)
      return origin + base + (nudge ?? 0);
    };

    const x = place(frame.origin.x, frame.size.width, measured.width, left, right, h, nudgeX);
    const y = place(frame.origin.y, frame.size.height, measured.height, top, bottom, v, nudgeY);

    // Place it for real at the resolved position.
    this.child.calculateLayout(constraints, { x, y }, ctx);
  }

  override getProps(): WithChild {
    return { child: this.child };
  }
}

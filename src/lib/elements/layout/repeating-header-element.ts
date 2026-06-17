import { BoxConstraints, Offset, Size } from "../../layout/box-constraints";
import {
  Fragmentable,
  FragmentResult,
  isFragmentable,
} from "../../layout/fragmentation";
import { LayoutContext, PDFElement } from "../pdf-element";

/**
 * Stacks a `header` above a `body` and, when it paginates, **repeats the header on every
 * fragment**. Used by `Table` so column headings reappear at the top of each page. Layout
 * is just header-then-body (like a 2-row Column); the magic is in `fragment`: it splits the
 * body and re-wraps each piece with the same header, so every physical page gets its own.
 */
export class RepeatingHeaderElement extends PDFElement implements Fragmentable {
  private x = 0;
  private y = 0;
  private width = 0;
  private height = 0;

  constructor(
    private header: PDFElement,
    private body: PDFElement,
    private gap: number = 0
  ) {
    super();
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    this.x = offset.x;
    this.y = offset.y;
    const width = constraints.hasBoundedWidth ? constraints.maxWidth : 0;

    const h = this.header.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      { x: this.x, y: this.y },
      ctx
    );
    const b = this.body.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      { x: this.x, y: this.y + h.height + this.gap },
      ctx
    );

    this.width = width;
    this.height = h.height + this.gap + b.height;
    return { width: this.width, height: this.height };
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    // Reserve the header's height on every page; the body flows in what's left.
    const headerHeight = this.header.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      { x: 0, y: 0 },
      ctx
    ).height;

    if (!isFragmentable(this.body)) return { fitted: this, remainder: null };

    const split = this.body.fragment(
      Math.max(0, maxHeight - headerHeight - this.gap),
      width,
      ctx
    );
    // Body fits whole → the whole thing fits on this page.
    if (split.remainder === null) return { fitted: this, remainder: null };

    // Re-wrap each body piece with the SAME header → it reappears on the next page too.
    return {
      fitted: split.fitted
        ? new RepeatingHeaderElement(this.header, split.fitted, this.gap)
        : null,
      remainder: new RepeatingHeaderElement(this.header, split.remainder, this.gap),
    };
  }

  override getProps() {
    return { x: this.x, y: this.y, width: this.width, height: this.height, header: this.header, body: this.body };
  }
}

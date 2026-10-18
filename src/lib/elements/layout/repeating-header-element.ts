import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import {
  Fragmentable,
  FragmentResult,
  insetContext,
  isFragmentable,
} from "../../layout/fragmentation.ts";
import { LayoutContext, PDFElement } from "../pdf-element.ts";

/** Gives every element of `fresh` the tagging identity of its twin in `from` (the same shape). */
function adoptStructIds(fresh: PDFElement, from: PDFElement): void {
  fresh.adoptStructId(from);
  const a = fresh.layoutChildren();
  const b = from.layoutChildren();
  for (let i = 0; i < a.length && i < b.length; i++) adoptStructIds(a[i]!, b[i]!);
}

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
    private gap: number = 0,
  ) {
    super();
  }

  /** The header for the next piece: a copy, since two pieces may share a page (two Regions of a Flow)
   *  and one element has one position - that tags as the SAME header. */
  private nextHeader(): PDFElement {
    const copy = this.header.clone();
    adoptStructIds(copy, this.header);
    return copy;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    const size = this.sizeWith(constraints, ctx, "layout");
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    return this.sizeWith(constraints, ctx, "measure");
  }

  /** The one sizing path: `layout` places header and body (relative to this box), `measure` sizes. */
  private sizeWith(
    constraints: BoxConstraints,
    ctx: LayoutContext,
    mode: "layout" | "measure",
  ): Size {
    const width = constraints.hasBoundedWidth ? constraints.maxWidth : 0;
    const inner = BoxConstraints.loose(width, Infinity);
    const h =
      mode === "layout"
        ? this.header.calculateLayout(inner, { x: 0, y: 0 }, ctx)
        : this.header.measure(inner, ctx);
    const b =
      mode === "layout"
        ? this.body.calculateLayout(inner, { x: 0, y: h.height + this.gap }, ctx)
        : this.body.measure(inner, ctx);
    return { width, height: h.height + this.gap + b.height };
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    // Reserve the header's height on every page; the body flows in what's left.
    const headerHeight = this.header.measure(BoxConstraints.loose(width, Infinity), ctx).height;

    if (!isFragmentable(this.body)) return { fitted: this, remainder: null };

    const chrome = headerHeight + this.gap;
    const split = this.body.fragment(
      Math.max(0, maxHeight - chrome),
      width,
      insetContext(ctx, chrome),
    );
    // Body fits whole, no break inside → the whole thing fits on this page.
    if (split.remainder === null && !split.forceBreak) return { fitted: this, remainder: null };

    // Re-wrap each body piece with the SAME header → it reappears on the next page too. A forced
    // break inside the body is passed on, so the page ends there.
    return {
      fitted: split.fitted
        ? new RepeatingHeaderElement(this.header, split.fitted, this.gap).asPieceOf(this)
        : null,
      remainder: split.remainder
        ? new RepeatingHeaderElement(this.nextHeader(), split.remainder, this.gap).asPieceOf(this)
        : null,
      forceBreak: split.forceBreak,
    };
  }

  /** A break inside the body is a break in the flow the table sits in. */
  override hasForcedBreak(): boolean {
    return this.body.hasForcedBreak();
  }

  override layoutChildren(): readonly PDFElement[] {
    return [this.header, this.body];
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      header: this.header,
      body: this.body,
    };
  }
}

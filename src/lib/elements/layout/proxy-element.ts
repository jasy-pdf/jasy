import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { Fragmentable, FragmentResult, isFragmentable } from "../../layout/fragmentation.ts";
import { LayoutContext, PDFElement } from "../pdf-element.ts";

/**
 * A wrapper that is transparent to layout (Flutter's `RenderProxyBox`): its one child gets the same
 * constraints, sits at the same offset and gives the same size. Every sizing and pagination signal the
 * child sends is passed on, so wrapping something never changes how it is sized or broken across
 * pages - a `PageBreak` inside a `Link` breaks, a `Bookmark` around a chapter splits like the chapter.
 *
 * What a wrapper adds (a link, a jump target, a role, inherited text defaults) it adds through two
 * hooks: `childContext` for what the child is laid out in, and `rewrap` for the pieces of a split.
 */
export abstract class ProxyElement extends PDFElement implements Fragmentable {
  // The box the child took, for renderers that mark it (a link's hit area, a jump target's top).
  protected x = 0;
  protected y = 0;
  protected width = 0;
  protected height = 0;

  protected constructor(protected readonly child: PDFElement) {
    super();
  }

  /** The context the child is laid out in: unchanged, unless the wrapper hands something down. */
  protected childContext(ctx: LayoutContext): LayoutContext {
    return ctx;
  }

  /**
   * This wrapper around a piece of its split child. `continued` is true for every piece but the first
   * one that holds something: a wrapper that marks a single place (a jump target, an outline entry)
   * returns the piece bare there, so the mark is not repeated on the next page.
   */
  protected abstract rewrap(child: PDFElement, continued: boolean): PDFElement;

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    const size = this.child.calculateLayout(constraints, offset, this.childContext(ctx));
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    return this.child.measure(constraints, this.childContext(ctx));
  }

  override layoutChildren(): readonly PDFElement[] {
    return [this.child];
  }

  /** Transparent to a surrounding Row or Column too: it sees the child's flex properties. */
  override proxied(): PDFElement {
    return this.child;
  }

  override relativeSizeFactor(horizontal: boolean): number | undefined {
    return this.child.relativeSizeFactor(horizontal);
  }

  override needsBoundedMain(horizontal: boolean): boolean {
    return this.child.needsBoundedMain(horizontal);
  }

  override minIntrinsicMain(horizontal: boolean, ctx: LayoutContext): number {
    return this.child.minIntrinsicMain(horizontal, this.childContext(ctx));
  }

  override isPageBreak(): boolean {
    return this.child.isPageBreak();
  }

  override hasForcedBreak(): boolean {
    return this.child.hasForcedBreak();
  }

  override breaksBefore(): boolean {
    return this.child.breaksBefore();
  }

  override breaksAfter(): boolean {
    return this.child.breaksAfter();
  }

  /** Splittable exactly when the child is; otherwise the parent moves it to the next page whole. */
  canFragment(): boolean {
    return isFragmentable(this.child);
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    if (!isFragmentable(this.child)) return { fitted: null, remainder: this };
    const childCtx = this.childContext(ctx);
    const split = this.child.fragment(maxHeight, width, childCtx);
    // The child handed itself back (it all fits, or none of it does): so does the wrapper, mark included.
    const wrap = (piece: PDFElement, continued: boolean): PDFElement => {
      if (piece === this.child) return this;
      const wrapped = this.rewrap(piece, continued);
      // A wrapper dropped from a continued piece still leaves that piece in its place in the flow.
      return wrapped === piece ? piece.takeFlexItemFrom(this) : wrapped.asPieceOf(this);
    };
    // A fitted piece with no height (what a leading `PageBreak` leaves) holds nothing to mark: the
    // mark goes on with the remainder, where the content is.
    const placed =
      split.fitted !== null &&
      (split.remainder === null ||
        split.fitted.measure(BoxConstraints.loose(width, Infinity), childCtx).height > 0);
    return {
      fitted: split.fitted && wrap(split.fitted, !placed),
      remainder: split.remainder && wrap(split.remainder, placed),
      forceBreak: split.forceBreak,
    };
  }
}

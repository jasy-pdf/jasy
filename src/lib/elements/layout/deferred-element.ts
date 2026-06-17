import { BoxConstraints, Offset, Size } from "../../layout/box-constraints";
import {
  Fragmentable,
  FragmentResult,
  isFragmentable,
} from "../../layout/fragmentation";
import { LayoutContext, PDFElement } from "../pdf-element";

/**
 * Builds its subtree at layout time via `resolve(ctx)`, so the tree can depend on font
 * metrics (e.g. a Table resolving `"auto"` column widths from cell content). The engine
 * stays table-agnostic - the closure comes from the API layer.
 */
export class DeferredElement extends PDFElement implements Fragmentable {
  private composed?: PDFElement;

  constructor(private resolve: (ctx: LayoutContext) => PDFElement) {
    super();
  }

  private build(ctx: LayoutContext): PDFElement {
    this.composed = this.resolve(ctx);
    return this.composed;
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    return this.build(ctx).calculateLayout(constraints, offset, ctx);
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    const c = this.build(ctx);
    return isFragmentable(c)
      ? c.fragment(maxHeight, width, ctx)
      : { fitted: this, remainder: null };
  }

  override getProps() {
    return { composed: this.composed };
  }
}

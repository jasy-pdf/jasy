import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { Fragmentable, FragmentResult, isFragmentable } from "../../layout/fragmentation.ts";
import { LayoutContext, PDFElement } from "../pdf-element.ts";
import { BuiltFromContext } from "../../layout/layout-cache.ts";

/**
 * Builds its subtree at layout time via `resolve(ctx)`, so the tree can depend on font
 * metrics (e.g. a Table resolving `"auto"` column widths from cell content). The engine
 * stays table-agnostic - the closure comes from the API layer.
 */
export class DeferredElement extends PDFElement implements Fragmentable {
  // The subtree that was laid out last, and so gets drawn. Measuring never replaces it.
  private composed?: PDFElement;
  private built = new BuiltFromContext<PDFElement>();

  constructor(private resolve: (ctx: LayoutContext) => PDFElement) {
    super();
  }

  /** The subtree for this context: built once, and again only when the context changes. */
  private subtree(ctx: LayoutContext): PDFElement {
    return this.built.get(ctx, () => this.resolve(ctx));
  }

  private build(ctx: LayoutContext): PDFElement {
    this.composed = this.subtree(ctx);
    return this.composed;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    return this.build(ctx).calculateLayout(constraints, offset, ctx);
  }

  /** Its subtree is unknown until built, and could hold a `PageBuilder`; until then assume it does. */
  override dependsOnPage(): boolean {
    return this.composed?.dependsOnPage() ?? true;
  }

  /** Sizes the subtree for this context - the same one a layout under it will draw. */
  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    return this.subtree(ctx).measure(constraints, ctx);
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    const c = this.build(ctx);
    return isFragmentable(c)
      ? c.fragment(maxHeight, width, ctx)
      : { fitted: this, remainder: null };
  }

  override layoutChildren(): readonly PDFElement[] {
    return this.composed ? [this.composed] : [];
  }

  override getProps() {
    return { composed: this.composed };
  }
}

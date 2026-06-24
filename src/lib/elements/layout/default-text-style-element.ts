import { PDFElement, LayoutContext, WithChild, SizedPDFElement } from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { Fragmentable, FragmentResult, isFragmentable } from "../../layout/fragmentation.ts";
import { DEFAULT_TEXT_STYLE, ResolvedTextStyle, mergeTextStyle } from "../../text/text-style.ts";

interface DefaultTextStyleParams extends WithChild {
  style: Partial<ResolvedTextStyle>;
}

/**
 * Provides default text properties (font/size/color/lineHeight/align/weight) to its whole subtree -
 * Flutter's `DefaultTextStyle`. Transparent to layout: the child takes the same constraints, offset
 * and size; only the inherited TextStyle changes. A `Text` below still wins per property, and these
 * overrides layer onto whatever the element already inherited from above.
 */
export class DefaultTextStyleElement extends SizedPDFElement implements Fragmentable {
  private child: PDFElement;
  private style: Partial<ResolvedTextStyle>;

  constructor({ child, style }: DefaultTextStyleParams) {
    super({ x: 0, y: 0 });
    this.child = child;
    this.style = style;
  }

  private childCtx(ctx: LayoutContext): LayoutContext {
    return {
      ...ctx,
      textStyle: mergeTextStyle(ctx.textStyle ?? DEFAULT_TEXT_STYLE, this.style),
    };
  }

  // Transparent to fragmentation too: split the child against the merged context, re-wrapping each
  // half so the remainder on the next page keeps the same defaults.
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    if (!isFragmentable(this.child)) return { fitted: null, remainder: this };
    const split = this.child.fragment(maxHeight, width, this.childCtx(ctx));
    return {
      fitted: split.fitted ? this.cloneWithChild(split.fitted) : null,
      remainder: split.remainder ? this.cloneWithChild(split.remainder) : null,
    };
  }

  private cloneWithChild(child: PDFElement): DefaultTextStyleElement {
    return new DefaultTextStyleElement({ child, style: this.style });
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    const size = this.child.calculateLayout(constraints, offset, this.childCtx(ctx));
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  override getProps() {
    return { x: this.x, y: this.y, width: this.width, height: this.height, child: this.child };
  }
}

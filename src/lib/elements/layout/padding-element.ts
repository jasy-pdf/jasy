import { Validator } from "../../validators/element-validator";
import {
  PDFElement,
  LayoutContext,
  WithChild,
  SizedPDFElement,
} from "../pdf-element";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints";
import {
  Fragmentable,
  FragmentResult,
  isFragmentable,
} from "../../layout/fragmentation";

// Padding sizes itself from its child + margin, so it takes no x/y of its own.
interface PaddingElementParams extends WithChild {
  margin: [number, number, number, number];
}

export class PaddingElement extends SizedPDFElement implements Fragmentable {
  private child: PDFElement;
  private margin: [number, number, number, number];

  constructor({ margin, child }: PaddingElementParams) {
    super({ x: 0, y: 0 });

    this.child = child;
    this.margin = margin;
  }

  /**
   * Splits the padded box across pages (box-decoration-break: clone - every fragment
   * keeps its full top/bottom inset). The child is fragmented into the space left after
   * reserving the vertical insets; each half is re-wrapped in its own padding. If the
   * child can't be split, the whole padding moves on as the remainder.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    if (!isFragmentable(this.child)) {
      return { fitted: null, remainder: this };
    }

    const [marginTop, marginRight, marginBottom, marginLeft] = this.margin;
    const childWidth = width - marginLeft - marginRight;
    const childMaxHeight = maxHeight - marginTop - marginBottom;

    const split = this.child.fragment(childMaxHeight, childWidth, ctx);
    return {
      fitted: split.fitted ? this.cloneWithChild(split.fitted) : null,
      remainder: split.remainder ? this.cloneWithChild(split.remainder) : null,
    };
  }

  private cloneWithChild(child: PDFElement): PaddingElement {
    return new PaddingElement({ margin: this.margin, child });
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    // Padding takes the width it is offered; its height shrink-wraps the child.
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    this.x = offset.x;
    this.y = offset.y;

    const [marginTop, marginRight, marginBottom, marginLeft] = this.margin;

    // The child is inset by the margins: shifted down/right, narrowed by the
    // horizontal margins, and left height-unbounded so it sizes to its own content.
    const childOffset: Offset = {
      x: this.x + marginLeft,
      y: this.y + marginTop,
    };
    const childWidth = constraints.hasBoundedWidth
      ? Math.max(0, constraints.maxWidth - marginLeft - marginRight)
      : Infinity;
    const childConstraints = BoxConstraints.loose(childWidth, Infinity);

    const childSize = this.child.calculateLayout(childConstraints, childOffset, ctx);
    this.height = childSize.height + marginTop + marginBottom;

    Validator.validateSizedElement(this);

    // Top-left coordinates; the Y-flip now happens once at the IR -> backend seam.
    return { width: this.width ?? 0, height: this.height };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      margin: this.margin,
      child: this.child,
    };
  }
}

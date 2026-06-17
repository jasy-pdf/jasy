import { Validator } from "../../validators/element-validator";
import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
  WithChild,
  FlexibleElement,
} from "../pdf-element";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints";
import { Fragmentable, FragmentResult, isFragmentable } from "../../layout/fragmentation";

interface ExpandedElementParams extends FlexibleElement, WithChild {}

export class ExpandedElement extends FlexiblePDFElement implements Fragmentable {
  private child: PDFElement;
  private x: number = 0;
  private y: number = 0;
  private width: number = 0;
  private height: number = 0;

  constructor({ flex, child }: ExpandedElementParams) {
    super({ flex });

    this.child = child;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    // Absolute placement from the parent; assignment (not +=) so re-layout is idempotent.
    this.x = offset.x;
    this.y = offset.y;

    Validator.validateFlexElement(this);

    if (constraints.hasBoundedHeight) {
      // A bounded region: fill it - the normal flex behaviour.
      this.height = constraints.maxHeight;
      this.child.calculateLayout(
        BoxConstraints.loose(this.width, this.height),
        { x: this.x, y: this.y },
        ctx,
      );
    } else {
      // Unbounded (measuring while paginating): there's no leftover space to fill, so
      // collapse to the child's natural height. This lets an overflowing column flow
      // instead of the flex silently hiding the overflow.
      const childSize = this.child.calculateLayout(
        BoxConstraints.loose(this.width, Infinity),
        { x: this.x, y: this.y },
        ctx,
      );
      this.height = childSize.height;
    }

    // Top-left coordinates; the Y-flip now happens once at the IR -> backend seam.
    return { width: this.width, height: this.height };
  }

  /**
   * When the column paginates, a flex region can't "fill" across pages, so it delegates to
   * its child: the child splits and each half is re-wrapped in an Expanded (which then
   * fills the leftover space on whichever page it lands). If the child can't split, the
   * whole Expanded moves on.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    if (!isFragmentable(this.child)) {
      return { fitted: null, remainder: this };
    }
    const split = this.child.fragment(maxHeight, width, ctx);
    return {
      fitted: split.fitted ? this.cloneWithChild(split.fitted) : null,
      remainder: split.remainder ? this.cloneWithChild(split.remainder) : null,
    };
  }

  private cloneWithChild(child: PDFElement): ExpandedElement {
    return new ExpandedElement({ flex: this.flex, child });
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      child: this.child,
    };
  }
}

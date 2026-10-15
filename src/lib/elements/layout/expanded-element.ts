import { Validator } from "../../validators/element-validator.ts";
import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
  WithChild,
  FlexibleElement,
} from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { Fragmentable, FragmentResult, isFragmentable } from "../../layout/fragmentation.ts";

interface ExpandedElementParams extends FlexibleElement, WithChild {}

export class ExpandedElement extends FlexiblePDFElement implements Fragmentable {
  private child: PDFElement;
  private x: number = 0;
  private y: number = 0;
  private width: number = 0;
  private height: number = 0;

  constructor({ flex, basis, basisFactor, child }: ExpandedElementParams) {
    super({ flex, basis, basisFactor });

    this.child = child;
  }

  /** Layout-transparent: the floor is whatever the wrapped child needs. */
  override minIntrinsicMain(horizontal: boolean, ctx: LayoutContext): number {
    return this.child.minIntrinsicMain(horizontal, ctx);
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    // Absolute placement from the parent; assignment (not +=) so re-layout is idempotent.
    this.x = offset.x;
    this.y = offset.y;

    Validator.validateFlexElement(this);

    // It fills its MAIN axis only. Across it, it is an ordinary child: with no width bound it takes
    // its content's width, from THIS call - never one left over from an earlier layout.
    const width = constraints.hasBoundedWidth ? constraints.maxWidth : Infinity;

    if (constraints.hasBoundedHeight) {
      // A bounded region: fill it - the normal flex behavior.
      this.height = constraints.maxHeight;
      const childSize = this.child.calculateLayout(
        BoxConstraints.loose(width, this.height),
        { x: this.x, y: this.y },
        ctx,
      );
      this.width = constraints.hasBoundedWidth ? width : childSize.width;
    } else {
      // Unbounded (measuring while paginating): there's no leftover space to fill, so
      // collapse to the child's natural height. This lets an overflowing column flow
      // instead of the flex silently hiding the overflow.
      const childSize = this.child.calculateLayout(
        BoxConstraints.loose(width, Infinity),
        { x: this.x, y: this.y },
        ctx,
      );
      this.width = constraints.hasBoundedWidth ? width : childSize.width;
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
    // The basis has to come along: a fragment that lost it would claim only its share of the leftover,
    // so a `flexBasis` slot would silently change width on the page it continues onto.
    return new ExpandedElement({
      flex: this.flex,
      basis: this.basis,
      basisFactor: this.basisFactor,
      child,
    });
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      basis: this.basis,
      basisFactor: this.basisFactor,
      child: this.child,
    };
  }
}

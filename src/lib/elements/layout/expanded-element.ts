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

  /** And the ceiling is the child's. */
  override maxExtent(horizontal: boolean): number {
    return this.child.maxExtent(horizontal);
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    Validator.validateFlexElement(this);
    const size = this.sizeWith(constraints, ctx, offset);
    // Absolute placement from the parent; assignment (not +=) so re-layout is idempotent.
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    return this.sizeWith(constraints, ctx, null);
  }

  /** The one sizing path: with an `offset` the child is laid out there, with `null` only measured. */
  private sizeWith(constraints: BoxConstraints, ctx: LayoutContext, offset: Offset | null): Size {
    // It fills its MAIN axis only. Across it, it is an ordinary child: with no width bound it takes
    // its content's width, from THIS call - never one left over from an earlier layout.
    const width = constraints.hasBoundedWidth ? constraints.maxWidth : Infinity;
    // A bounded region: fill it - the normal flex behavior. Unbounded (measuring while paginating):
    // there's no leftover space to fill, so collapse to the child's natural height. This lets an
    // overflowing column flow instead of the flex silently hiding the overflow.
    // `Expanded(child)` is `flex: 1` on the child: the extent its line SET (the min) is the child's too,
    // so its own width or height gives way to its share - as in CSS and Flutter.
    const childConstraints = new BoxConstraints(
      constraints.minWidth,
      width,
      constraints.minHeight,
      constraints.hasBoundedHeight ? constraints.maxHeight : Infinity,
    );
    const childSize = offset
      ? this.child.calculateLayout(childConstraints, { x: offset.x, y: offset.y }, ctx)
      : this.child.measure(childConstraints, ctx);
    return {
      width: constraints.hasBoundedWidth ? width : childSize.width,
      height: constraints.hasBoundedHeight ? constraints.maxHeight : childSize.height,
    };
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
      forceBreak: split.forceBreak,
    };
  }

  override needsRegion(): boolean {
    return this.child.needsRegion();
  }

  // The child IS the flex item: what it needs across the line, the line must give it.
  override needsBoundedMain(horizontal: boolean): boolean {
    return this.child.needsBoundedMain(horizontal);
  }

  // A break inside the flex child is a break in the flow it sits in.
  override hasForcedBreak(): boolean {
    return this.child.hasForcedBreak();
  }

  override breaksBefore(): boolean {
    return this.child.breaksBefore();
  }

  override breaksAfter(): boolean {
    return this.child.breaksAfter();
  }

  private cloneWithChild(child: PDFElement): ExpandedElement {
    // The basis has to come along: a fragment that lost it would claim only its share of the leftover,
    // so a `flexBasis` slot would silently change width on the page it continues onto.
    return new ExpandedElement({
      flex: this.flex,
      basis: this.basis,
      basisFactor: this.basisFactor,
      child,
    }).asPieceOf(this);
  }

  override layoutChildren(): readonly PDFElement[] {
    return [this.child];
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

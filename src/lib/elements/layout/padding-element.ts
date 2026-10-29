import { Validator } from "../../validators/element-validator.ts";
import {
  PDFElement,
  LayoutContext,
  WithChild,
  SizedPDFElement,
  withPaddingBase,
} from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import {
  Fragmentable,
  FragmentResult,
  insetContext,
  isFragmentable,
} from "../../layout/fragmentation.ts";
import { resolveEdges, type EdgeSpecs } from "../../layout/insets.ts";

// Padding sizes itself from its child + margin, so it takes no x/y of its own.
interface PaddingElementParams extends WithChild {
  /** Still unresolved: a side may be a percentage of the offered WIDTH (see `Insets`). */
  margin: EdgeSpecs;
  /** This is a `Box`'s own padding: a percentage resolves against what the Box was offered
   *  (`ctx.boxPaddingBase`), as CSS resolves it against the containing block. */
  ofBox?: boolean;
}

export class PaddingElement extends SizedPDFElement implements Fragmentable {
  private child: PDFElement;
  private margin: EdgeSpecs;
  readonly ofBox: boolean;

  constructor({ margin, child, ofBox = false }: PaddingElementParams) {
    super({ x: 0, y: 0 });

    this.child = child;
    this.margin = margin;
    this.ofBox = ofBox;
  }

  /** Some side is a percentage. */
  get hasPercentSide(): boolean {
    return this.margin.some((side) => typeof side !== "number" && side.factor !== undefined);
  }

  /** The width a percentage side resolves against, and the context the child sees: a Box's base is
   *  for this padding alone, so it does not travel further down. */
  private percentBase(width: number, ctx: LayoutContext): number {
    return this.ofBox && ctx.boxPaddingBase !== undefined ? ctx.boxPaddingBase : width;
  }
  private childContext(ctx: LayoutContext): LayoutContext {
    return withPaddingBase(ctx, undefined);
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

    const [marginTop, marginRight, marginBottom, marginLeft] = resolveEdges(
      this.margin,
      this.percentBase(width, ctx),
    );
    const childWidth = width - marginLeft - marginRight;
    const childMaxHeight = maxHeight - marginTop - marginBottom;

    const split = this.child.fragment(
      childMaxHeight,
      childWidth,
      insetContext(this.childContext(ctx), marginTop + marginBottom),
    );
    return {
      fitted: split.fitted ? this.cloneWithChild(split.fitted) : null,
      remainder: split.remainder ? this.cloneWithChild(split.remainder) : null,
      forceBreak: split.forceBreak,
    };
  }

  /** A wrapper: it needs a bound exactly when its child does, and passes the bound on. */
  override needsBoundedMain(horizontal: boolean): boolean {
    return this.child.needsBoundedMain(horizontal);
  }

  override needsRegion(): boolean {
    return this.child.needsRegion();
  }

  override hasForcedBreak(): boolean {
    return this.child.hasForcedBreak();
  }

  // Padding is a transparent single-child wrapper, so a break-before/after on the wrapped element must
  // still be seen by the parent packer at this boundary (otherwise it is swallowed).
  override breaksBefore(): boolean {
    return this.child.breaksBefore();
  }

  override breaksAfter(): boolean {
    return this.child.breaksAfter();
  }

  private cloneWithChild(child: PDFElement): PaddingElement {
    return new PaddingElement({ margin: this.margin, child, ofBox: this.ofBox }).asPieceOf(this);
  }

  /**
   * The child plus our own insets. A PERCENTAGE inset counts as zero here: it resolves against a width
   * that is not decided yet, which is exactly how CSS treats a percentage when sizing intrinsically.
   */
  override minIntrinsicMain(horizontal: boolean, ctx: LayoutContext): number {
    const [top, right, bottom, left] = resolveEdges(this.margin, 0);
    return (
      this.child.minIntrinsicMain(horizontal, ctx) + (horizontal ? left + right : top + bottom)
    );
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    const size = this.sizeWith(constraints, ctx, "layout");
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    Validator.validateSizedElement(this);
    return size;
  }

  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    return this.sizeWith(constraints, ctx, "measure");
  }

  /** The one sizing path: `layout` places the child (relative to this box), `measure` only sizes it. */
  private sizeWith(
    constraints: BoxConstraints,
    ctx: LayoutContext,
    mode: "layout" | "measure",
  ): Size {
    // Percentages resolve against the width we were OFFERED (a Box's: what the Box was offered), so
    // every pass gets the same answer.
    const [marginTop, marginRight, marginBottom, marginLeft] = resolveEdges(
      this.margin,
      this.percentBase(constraints.maxWidth, ctx),
    );

    // The child is inset by the margins: shifted down/right, narrowed by the horizontal margins, and
    // left height-unbounded so it sizes to its own content - unless it cannot lay itself out without a
    // bound (a stack holding a Spacer): that one gets the height inside the margins, as it would without
    // the padding.
    const childWidth = constraints.hasBoundedWidth
      ? Math.max(0, constraints.maxWidth - marginLeft - marginRight)
      : Infinity;
    const childHeight =
      constraints.hasBoundedHeight && this.child.needsBoundedMain(false)
        ? Math.max(0, constraints.maxHeight - marginTop - marginBottom)
        : Infinity;
    const childConstraints = BoxConstraints.loose(childWidth, childHeight);
    const childCtx = this.childContext(ctx);
    const childSize =
      mode === "layout"
        ? this.child.calculateLayout(childConstraints, { x: marginLeft, y: marginTop }, childCtx)
        : this.child.measure(childConstraints, childCtx);

    // Padding takes the width it is offered; its height shrink-wraps the child. Unbounded width (a
    // fixed child in a Row) shrink-wraps to the child + insets, as Container/Row do.
    return {
      width: constraints.hasBoundedWidth
        ? constraints.maxWidth
        : childSize.width + marginLeft + marginRight,
      height: childSize.height + marginTop + marginBottom,
    };
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
      margin: this.margin,
      child: this.child,
    };
  }
}

import {
  FlexLayoutHelper,
  VERTICAL_AXIS,
  MainAlign,
  CrossAlign,
} from "../utils/flex-layout";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import {
  Fragmentable,
  FragmentResult,
  packChildren,
} from "../layout/fragmentation";
import {
  LayoutContext,
  PDFElement,
  SizedElement,
  SizedPDFElement,
  WithChildren,
} from "./pdf-element";

interface ContainerElementParams extends SizedElement, WithChildren {
  /** Space between children. */
  gap?: number;
  /** Vertical distribution of the children (main axis). */
  main?: MainAlign;
  /** Horizontal alignment of each child (cross axis); defaults to `stretch`. */
  cross?: CrossAlign;
}

export class ContainerElement extends SizedPDFElement implements Fragmentable {
  private children: PDFElement[];
  private gap: number;
  private main: MainAlign;
  private cross: CrossAlign;

  constructor({ x, y, width, height, children, gap, main, cross }: ContainerElementParams) {
    super({ x, y, width, height });

    this.children = children;
    this.gap = gap ?? 0;
    this.main = main ?? "start";
    this.cross = cross ?? "stretch";
  }

  /**
   * Splits the vertical stack across pages. Children are measured against the content
   * width and packed until one would exceed `maxHeight`. That straddling child is itself
   * fragmented if it can be (Slice 1: a text paragraph splits at line boxes); otherwise
   * it moves whole. Everything after the break spills into the remainder. Progress is
   * guaranteed: if nothing fit on the page, the straddling child is forced on (it
   * overflows) so the next region always makes headway.
   *
   * Flex children make the container absorb the leftover space, so it never overflows -
   * in that case we don't fragment and hand the whole container back as `fitted`.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    const { fitted, remainder } = packChildren(
      this.children,
      maxHeight,
      width,
      ctx,
      this.gap
    );
    // Fits as one region: hand the whole container back so the page renders unchanged
    // (its normal layout distributes flex / fills the page).
    if (remainder.length === 0) return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithChildren(fitted),
      remainder: this.cloneWithChildren(remainder),
    };
  }

  private cloneWithChildren(children: PDFElement[]): ContainerElement {
    return new ContainerElement({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      children,
      gap: this.gap,
      main: this.main,
      cross: this.cross,
    });
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    // The container fills the width/height it is offered; when an axis is unbounded it
    // shrink-wraps to its children instead (mirrors how Row shrink-wraps). Width unbounded
    // happens for a Column nested in a Row (the Row offers its fixed children unbounded
    // width); passing 0 there would collapse every child to width 0.
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    if (constraints.hasBoundedHeight) this.height = constraints.maxHeight;
    this.x = offset.x;
    this.y = offset.y;

    const crossAvail = constraints.hasBoundedWidth ? this.width! : Infinity;
    const mainAvail = constraints.hasBoundedHeight ? this.height! : Infinity;

    let result = { mainUsed: 0, crossUsed: 0 };
    if (this.children) {
      // Vertical flex stack (main = height, cross = width). The shared helper measures
      // fixed children, distributes the leftover to flex children, and places everything
      // in source order.
      result = FlexLayoutHelper.layout(
        this.children,
        VERTICAL_AXIS,
        mainAvail,
        crossAvail,
        this.y,
        this.x,
        { gap: this.gap, main: this.main, cross: this.cross },
        ctx
      );
    }

    // Bounded: fill the offered extent. Unbounded: shrink to the children (height = the
    // stack, width = the widest child). Top-left coordinates; the container draws nothing,
    // and the Y-flip happens once at the IR -> backend seam.
    const width = constraints.hasBoundedWidth ? this.width! : result.crossUsed;
    const height = constraints.hasBoundedHeight ? this.height! : result.mainUsed;
    this.width = width;
    this.height = height;
    return { width, height };
  }

  override getProps(): ContainerElementParams {
    return {
      x: this.x,
      y: this.y,
      width: this.width!,
      height: this.height,
      children: this.children,
      gap: this.gap,
      main: this.main,
      cross: this.cross,
    };
  }
}

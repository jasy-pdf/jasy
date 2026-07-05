import { FlexLayoutHelper, VERTICAL_AXIS, MainAlign, CrossAlign } from "../utils/flex-layout.ts";
import { BoxConstraints, Offset, Size, resolveExtent } from "../layout/box-constraints.ts";
import { Fragmentable, FragmentResult, packChildren } from "../layout/fragmentation.ts";
import {
  LayoutContext,
  PDFElement,
  SizedElement,
  SizedPDFElement,
  WithChildren,
} from "./pdf-element.ts";

interface ContainerElementParams extends SizedElement, WithChildren {
  /** Space between children. */
  gap?: number;
  /** Vertical distribution of the children (main axis). */
  main?: MainAlign;
  /** Horizontal alignment of each child (cross axis); defaults to `stretch`. */
  cross?: CrossAlign;
  /** Width/height as a fraction (0..1) of the offered box instead of `width`/`height` (relative sizing). */
  widthFactor?: number;
  heightFactor?: number;
}

export class ContainerElement extends SizedPDFElement implements Fragmentable {
  private children: PDFElement[];
  private gap: number;
  private main: MainAlign;
  private cross: CrossAlign;
  // The requested size, snapshot at construction so re-layouts (fragmentation measuring, which
  // mutate this.width/height) still see what the user asked for. `undefined` = fill / shrink-wrap.
  private requested: {
    width?: number;
    height?: number;
    widthFactor?: number;
    heightFactor?: number;
  };

  constructor({
    x,
    y,
    width,
    height,
    children,
    gap,
    main,
    cross,
    widthFactor,
    heightFactor,
  }: ContainerElementParams) {
    super({ x, y, width, height });

    this.children = children;
    this.gap = gap ?? 0;
    this.main = main ?? "start";
    this.cross = cross ?? "stretch";
    this.requested = { width, height, widthFactor, heightFactor };
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
    const { fitted, remainder } = packChildren(this.children, maxHeight, width, ctx, this.gap);
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
      // Carry the requested WIDTH (a %-width column keeps its width on every page); the height is
      // intentionally dropped so each fragment shrink-wraps to the content it actually holds.
      width: this.requested.width,
      widthFactor: this.requested.widthFactor,
      children,
      gap: this.gap,
      main: this.main,
      cross: this.cross,
    });
  }

  override relativeSizeFactor(horizontal: boolean): number | undefined {
    return horizontal ? this.requested.widthFactor : this.requested.heightFactor;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;

    // Relative sizing: a pinned extent (fixed points or a fraction of the offered box, clamped into
    // the constraints) wins; else fill a bounded axis; else stay `undefined` and shrink-wrap below.
    // A Column nested in a Row gets unbounded width - passing 0 there would collapse children to 0.
    const explicitWidth = resolveExtent(
      this.requested.width,
      this.requested.widthFactor,
      constraints.maxWidth,
      constraints.hasBoundedWidth,
    );
    const explicitHeight = resolveExtent(
      this.requested.height,
      this.requested.heightFactor,
      constraints.maxHeight,
      constraints.hasBoundedHeight,
    );
    const boundedWidth =
      explicitWidth !== undefined
        ? constraints.constrainWidth(explicitWidth)
        : constraints.hasBoundedWidth
          ? constraints.maxWidth
          : undefined;
    const boundedHeight =
      explicitHeight !== undefined
        ? constraints.constrainHeight(explicitHeight)
        : constraints.hasBoundedHeight
          ? constraints.maxHeight
          : undefined;

    // Vertical stack: cross = width (children fill it), main = height (the stacking extent).
    const crossAvail = boundedWidth ?? Infinity;
    const mainAvail = boundedHeight ?? Infinity;

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
        ctx,
      );
    }

    // Pinned/bounded axis takes that extent; an unbounded one shrink-wraps to the children (height =
    // the stack, width = the widest child). Top-left coordinates; the container draws nothing, and
    // the Y-flip happens once at the IR -> backend seam.
    this.width = boundedWidth ?? result.crossUsed;
    this.height = boundedHeight ?? result.mainUsed;
    return { width: this.width, height: this.height };
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

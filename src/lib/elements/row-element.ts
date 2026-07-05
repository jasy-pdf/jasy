import { BoxConstraints, Offset, Size, resolveExtent } from "../layout/box-constraints.ts";
import { FlexLayoutHelper, HORIZONTAL_AXIS, MainAlign, CrossAlign } from "../utils/flex-layout.ts";
import { LayoutContext, PDFElement, SizedPDFElement, WithChildren } from "./pdf-element.ts";

interface RowElementParams extends WithChildren {
  /** Space inserted between children, in points. */
  gap?: number;
  /** Horizontal distribution of the children (main axis). */
  main?: MainAlign;
  /** Vertical alignment of each child (cross axis); defaults to `stretch`. */
  cross?: CrossAlign;
  /** Width/height as points (fixed) or a fraction (0..1) of the offered box (relative sizing). */
  width?: number;
  height?: number;
  widthFactor?: number;
  heightFactor?: number;
}

/**
 * Horizontal stack: the mirror of `ContainerElement` (Column). Children are laid out
 * left-to-right via the shared `FlexLayoutHelper` on the horizontal axis; fixed children
 * take their natural width, `ExpandedElement`/Spacer children split the leftover width by
 * `flex`, and `gap` is inserted between them. The row fills the width it is offered and
 * shrink-wraps its height to the tallest child (unless a height is forced on it).
 *
 * Cross/main alignment is the next foundation slice; today children sit at the top-left
 * (cross start, main start). The row is atomic w.r.t. pagination - it reflows whole if it
 * does not fit (handled by the parent's `packChildren`); synchronized cell splitting is a
 * Grid/Table concern.
 */
export class RowElement extends SizedPDFElement {
  private children: PDFElement[];
  private gap: number;
  private main: MainAlign;
  private cross: CrossAlign;
  // The requested size (fixed points or a fraction), kept separate from the laid-out this.width/height.
  private requested: { width?: number; height?: number; widthFactor?: number; heightFactor?: number };

  constructor({ children, gap, main, cross, width, height, widthFactor, heightFactor }: RowElementParams) {
    super({ x: 0, y: 0 });
    this.children = children;
    this.gap = gap ?? 0;
    this.main = main ?? "start";
    this.cross = cross ?? "stretch";
    this.requested = { width, height, widthFactor, heightFactor };
  }

  override relativeSizeFactor(horizontal: boolean): number | undefined {
    return horizontal ? this.requested.widthFactor : this.requested.heightFactor;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;

    // Relative sizing: a pinned extent (fixed or a fraction of the offered box, clamped) wins; else
    // width fills the offered space (flex children split the leftover) and height is the tallest child.
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

    // Horizontal stack: main = width (children fill it), cross = height (children can stretch to it).
    const mainAvail = boundedWidth ?? Infinity;
    const crossAvail = boundedHeight ?? Infinity;

    let result = { mainUsed: 0, crossUsed: 0 };
    if (this.children.length > 0) {
      result = FlexLayoutHelper.layout(
        this.children,
        HORIZONTAL_AXIS,
        mainAvail,
        crossAvail,
        this.x,
        this.y,
        { gap: this.gap, main: this.main, cross: this.cross },
        ctx,
      );
    }

    this.width = boundedWidth ?? result.mainUsed;
    this.height = boundedHeight ?? result.crossUsed;

    return { width: this.width, height: this.height };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      children: this.children,
      gap: this.gap,
      main: this.main,
      cross: this.cross,
    };
  }
}

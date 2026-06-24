import { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";
import { FlexLayoutHelper, HORIZONTAL_AXIS, MainAlign, CrossAlign } from "../utils/flex-layout.ts";
import { LayoutContext, PDFElement, SizedPDFElement, WithChildren } from "./pdf-element.ts";

interface RowElementParams extends WithChildren {
  /** Space inserted between children, in points. */
  gap?: number;
  /** Horizontal distribution of the children (main axis). */
  main?: MainAlign;
  /** Vertical alignment of each child (cross axis); defaults to `stretch`. */
  cross?: CrossAlign;
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

  constructor({ children, gap, main, cross }: RowElementParams) {
    super({ x: 0, y: 0 });
    this.children = children;
    this.gap = gap ?? 0;
    this.main = main ?? "start";
    this.cross = cross ?? "stretch";
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;

    // Width fills the offered space (flex children split the leftover); height is the
    // tallest child unless the parent bounds it.
    const mainAvail = constraints.hasBoundedWidth ? constraints.maxWidth : Infinity;
    const crossAvail = constraints.hasBoundedHeight ? constraints.maxHeight : Infinity;

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

    this.width = constraints.hasBoundedWidth ? constraints.maxWidth : result.mainUsed;
    this.height = constraints.hasBoundedHeight ? constraints.maxHeight : result.crossUsed;

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

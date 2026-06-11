import { Color } from "../common/color";
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

interface RectangleElementParams extends SizedElement, WithChildren {
  color?: Color;
  backgroundColor?: Color;
  borderWidth?: number;
}

export class RectangleElement extends SizedPDFElement implements Fragmentable {
  private children: PDFElement[] = [];
  private color: Color;
  private backgroundColor?: Color;
  private borderWidth: number;

  private sizeMemory!: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };

  constructor({
    children = [],
    color = new Color(0, 0, 0),
    backgroundColor,
    borderWidth,
    width,
    height,
  }: RectangleElementParams) {
    super({ x: 0, y: 0, width, height });

    this.children = children;
    this.color = color;
    this.backgroundColor = backgroundColor;
    this.borderWidth = borderWidth ? borderWidth : 1;
    this.sizeMemory = { x: 0, y: 0, width, height };
  }

  /**
   * Splits the bordered box across pages (box-decoration-break: clone - every fragment
   * gets its own full border). The children stack is packed into the space left after
   * reserving the border on top and bottom; each fragment then shrink-wraps its own
   * content (explicit height = content + 2*border) so the border hugs the text instead of
   * filling the page. An explicit box height is intentionally overridden here - a split
   * box is sized by what it actually holds on each page.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    const boxWidth = this.sizeMemory.width ?? width;
    const innerWidth = Math.max(0, boxWidth - 2 * this.borderWidth);
    // Border-box: the content is inset by the border on top and bottom, so a fragment
    // holding `c` of content is `c + 2*border` tall. (Derived, not a fudge factor.)
    const innerMaxHeight = maxHeight - 2 * this.borderWidth;

    const { fitted, remainder } = packChildren(
      this.children,
      innerMaxHeight,
      innerWidth,
      ctx
    );
    if (remainder.length === 0) return { fitted: this, remainder: null };

    const contentHeight = (kids: PDFElement[]): number =>
      kids.reduce(
        (sum, child) =>
          sum +
          child.calculateLayout(
            BoxConstraints.loose(innerWidth, Infinity),
            { x: 0, y: 0 },
            ctx
          ).height,
        0
      );

    return {
      fitted: this.cloneWithChildren(
        fitted,
        contentHeight(fitted) + 2 * this.borderWidth
      ),
      remainder: this.cloneWithChildren(
        remainder,
        contentHeight(remainder) + 2 * this.borderWidth
      ),
    };
  }

  private cloneWithChildren(
    children: PDFElement[],
    height: number
  ): RectangleElement {
    return new RectangleElement({
      x: 0,
      y: 0,
      width: this.sizeMemory.width,
      height,
      children,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderWidth: this.borderWidth,
    });
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    // An explicit size wins (clamped to the available space); only fall back to filling
    // the offered box when no size was given. Without this a fixed-height box balloons
    // to the parent's height.
    this.width =
      this.sizeMemory.width !== undefined
        ? constraints.constrainWidth(this.sizeMemory.width)
        : constraints.hasBoundedWidth
        ? constraints.maxWidth
        : this.width;
    this.height =
      this.sizeMemory.height !== undefined
        ? constraints.constrainHeight(this.sizeMemory.height)
        : constraints.hasBoundedHeight
        ? constraints.maxHeight
        : this.height;
    this.x = this.sizeMemory.x + offset.x;
    this.y = this.sizeMemory.y + offset.y;

    // Lay out children stacked inside the border (inset by the border width). Width is
    // finalized here; height is left unbounded so each child sizes to its own content.
    const innerWidth = Math.max(0, (this.width ?? 0) - 2 * this.borderWidth);
    let yCursor = this.y + this.borderWidth;
    for (const child of this.children) {
      const childSize = child.calculateLayout(
        BoxConstraints.loose(innerWidth, Infinity),
        { x: this.x + this.borderWidth, y: yCursor },
        ctx
      );
      yCursor += childSize.height;
    }

    // Border-box model: width/height ARE the outer box (the rect we draw); the content
    // is inset by the border on every side. Report the honest box size - no phantom
    // border added on (that asymmetric "+border" was the source of the magic-3 fudge in
    // fragment). Top-left coordinates; the Y-flip happens at the IR -> backend seam.
    return {
      width: this.width ?? 0,
      height: this.height ?? 0,
    };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width!,
      height: this.height,
      children: this.children,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderWidth: this.borderWidth,
    };
  }
}

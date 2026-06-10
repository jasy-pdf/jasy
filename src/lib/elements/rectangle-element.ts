import { Color } from "../common/color";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
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

export class RectangleElement extends SizedPDFElement {
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

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    _ctx: LayoutContext
  ): Size {
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    if (constraints.hasBoundedHeight) this.height = constraints.maxHeight;
    this.x = this.sizeMemory.x + offset.x;
    this.y = this.sizeMemory.y + offset.y;

    // Top-left coordinates; the Y-flip happens once at the IR -> backend seam.
    // The rectangle grows by its border width.
    return {
      width: (this.width ?? 0) + this.borderWidth,
      height: (this.height ?? 0) + this.borderWidth,
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

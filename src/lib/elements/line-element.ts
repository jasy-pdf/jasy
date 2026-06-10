import { Color } from "../common/color";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import { LayoutContext, SizedElement, SizedPDFElement } from "./pdf-element";

interface LineElementParams extends SizedElement {
  color?: Color;
  strokeWidth?: number;
  x: number;
  y: number;
  xEnd: number;
  yEnd: number;
}

export class LineElement extends SizedPDFElement {
  private color?: Color;
  private strokeWidth?: number;
  private xEnd: number;
  private yEnd: number;

  private sizeMemory!: {
    x: number;
    y: number;
    width?: number;
    height?: number;
  };

  constructor({
    color = new Color(0, 0, 0),
    strokeWidth,
    x,
    y,
    xEnd,
    yEnd,
  }: LineElementParams) {
    super({ x: x, y: y, width: xEnd, height: y + yEnd });

    this.color = color;
    this.strokeWidth = strokeWidth ? strokeWidth : 1;
    this.x = x;
    this.y = y;
    this.xEnd = xEnd;
    this.yEnd = yEnd;
    this.sizeMemory = { x, y, width: xEnd, height: yEnd };
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    _ctx: LayoutContext
  ): Size {
    // Set relative to parent
    this.x = this.sizeMemory.x + offset.x;
    this.y = this.sizeMemory.y + offset.y;

    // The line spans the parent's width, so it needs a bounded width to anchor its end.
    if (!constraints.hasBoundedWidth) {
      throw new Error(
        "The LineElement must be placed inside a parent container that defines its width"
      );
    }

    this.xEnd = offset.x + constraints.maxWidth - this.sizeMemory.width!;
    this.yEnd = offset.y + this.sizeMemory.height!;

    // Top-left coordinates; the Y-flip happens once at the IR -> backend seam.
    return { width: this.width ?? 0, height: this.height ?? 0 };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      xEnd: this.xEnd,
      yEnd: this.yEnd,
      height: this.height,
      width: this.width,
      color: this.color,
      strokeWidth: this.strokeWidth,
    };
  }
}

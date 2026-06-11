import {
  SizedElement,
  WithChildren,
  SizedPDFElement,
  PDFElement,
  LayoutContext,
} from "../pdf-element";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints";

interface ContainerElementParams extends SizedElement, WithChildren {
  color?: [number, number, number];
  backgroundColor?: [number, number, number];
  borderWidth?: number;
}

export class SizedContainerElement extends SizedPDFElement {
  private children: PDFElement[];

  constructor({ width, height, children }: ContainerElementParams) {
    super({ x: 0, y: 0, width, height });

    this.children = children;
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    if (constraints.hasBoundedHeight) this.height = constraints.maxHeight;
    // Absolute placement from the parent; assignment (not +=) so re-layout is idempotent.
    this.x = offset.x;
    this.y = offset.y;

    const width = this.width ?? 0;
    const height = this.height ?? 0;

    if (this.children)
      this.children.forEach((child) =>
        child.calculateLayout(
          BoxConstraints.loose(width, height),
          { x: this.x, y: this.y },
          ctx
        )
      );

    // Top-left coordinates; the Y-flip now happens once at the IR -> backend seam.
    return { width, height };
  }

  override getProps(): ContainerElementParams {
    return {
      x: this.x,
      y: this.y,
      width: this.width!,
      height: this.height,
      children: this.children,
    };
  }
}

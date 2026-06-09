import {
  SizedElement,
  WithChildren,
  SizedPDFElement,
  PDFElement,
  LayoutConstraints,
  LayoutContext,
} from "../pdf-element";

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
    parentConstraints: LayoutConstraints | undefined,
    ctx: LayoutContext
  ): LayoutConstraints {
    if (parentConstraints) {
      if (parentConstraints.width) this.width = parentConstraints.width;
      if (parentConstraints.height) this.height = parentConstraints.height;
      this.x += parentConstraints.x;
      this.y += parentConstraints.y;
    }

    const result = {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };

    if (this.children)
      this.children.forEach((child) => child.calculateLayout(result, ctx));

    // Top-left coordinates; the Y-flip now happens once at the IR -> backend seam.
    return result;
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

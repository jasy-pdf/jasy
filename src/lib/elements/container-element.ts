import { FlexLayoutHelper } from "../utils/flex-layout";
import {
  FlexiblePDFElement,
  LayoutConstraints,
  LayoutContext,
  PDFElement,
  SizedElement,
  SizedPDFElement,
  WithChildren,
} from "./pdf-element";

interface ContainerElementParams extends SizedElement, WithChildren {}

export class ContainerElement extends SizedPDFElement {
  private children: PDFElement[];

  constructor({ x, y, width, height, children }: ContainerElementParams) {
    super({ x, y, width, height });

    this.children = children;
  }

  calculateLayout(
    parentConstraints: LayoutConstraints | undefined,
    ctx: LayoutContext
  ): LayoutConstraints {
    if (parentConstraints) {
      if (parentConstraints.width) this.width = parentConstraints.width;
      if (parentConstraints.height) this.height = parentConstraints.height;
      this.x = parentConstraints.x;
      this.y = parentConstraints.y;
    }

    const result = {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };

    if (this.children) {
      // Helper to caluclate the height
      const { positions, usedHeight, totalFlex } =
        FlexLayoutHelper.calculateFlexLayout(this.children, result, this.y, ctx);
      // Calc the remaining height and set the current positions
      const remainingHeight = Math.max((result.height || 0) - usedHeight, 0);

      for (let position of positions) {
        const { element, y } = position;
        if (element instanceof FlexiblePDFElement) {
          const flexHeight = (element.getFlex() / totalFlex) * remainingHeight;
          element.calculateLayout(
            {
              ...result,
              y: y,
              height: flexHeight,
            },
            ctx
          );
        } else {
          // Fixed elements are already calculated. Set only the y position
          element.calculateLayout(
            {
              ...result,
              y: y,
            },
            ctx
          );
        }
      }
    }

    // Top-left coordinates; the container itself draws nothing, and the Y-flip now
    // happens once at the IR -> backend seam.
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

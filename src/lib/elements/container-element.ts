import { FlexLayoutHelper } from "../utils/flex-layout";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import {
  FlexiblePDFElement,
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
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    // The container fills the space it is offered.
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    if (constraints.hasBoundedHeight) this.height = constraints.maxHeight;
    this.x = offset.x;
    this.y = offset.y;

    const width = this.width ?? 0;
    const height = this.height ?? 0;

    if (this.children) {
      const inner = BoxConstraints.loose(width, height);
      // Helper to caluclate the height
      const { positions, usedHeight, totalFlex } =
        FlexLayoutHelper.calculateFlexLayout(
          this.children,
          inner,
          this.x,
          this.y,
          ctx
        );
      // Calc the remaining height and set the current positions
      const remainingHeight = Math.max(height - usedHeight, 0);

      for (let position of positions) {
        const { element, y } = position;
        if (element instanceof FlexiblePDFElement) {
          const flexHeight = (element.getFlex() / totalFlex) * remainingHeight;
          element.calculateLayout(
            BoxConstraints.loose(width, flexHeight),
            { x: this.x, y },
            ctx
          );
        } else {
          // Fixed elements are already calculated. Set only the y position
          element.calculateLayout(
            BoxConstraints.loose(width, height),
            { x: this.x, y },
            ctx
          );
        }
      }
    }

    // Top-left coordinates; the container itself draws nothing, and the Y-flip now
    // happens once at the IR -> backend seam.
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

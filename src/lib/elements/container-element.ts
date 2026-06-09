import { pageFormats } from "../constants/page-sizes";
import { Orientation } from "../renderer/pdf-config";
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
import type { PDFPageConfig } from "./page-element";

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

    this.normalizeCoordinates(ctx.pageConfig);
    return result;
  }

  normalizeCoordinates(pageConfig: PDFPageConfig) {
    const pageHeight =
      pageFormats[pageConfig.pageSize!][
        pageConfig.orientation === Orientation.landscape ? 0 : 1
      ];
    this.y = pageHeight - this.y - (this.height || 0);
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

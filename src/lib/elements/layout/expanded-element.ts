import { pageFormats } from "../../constants/page-sizes";
import { Orientation } from "../../renderer/pdf-config";
import { Validator } from "../../validators/element-validator";
import {
  PDFElement,
  LayoutConstraints,
  LayoutContext,
  FlexiblePDFElement,
  WithChild,
  FlexibleElement,
} from "../pdf-element";
import type { PDFPageConfig } from "../page-element";

interface ExpandedElementParams extends FlexibleElement, WithChild {}

export class ExpandedElement extends FlexiblePDFElement {
  private child: PDFElement;
  private x: number = 0;
  private y: number = 0;
  private width: number = 0;
  private height: number = 0;

  constructor({ flex, child }: ExpandedElementParams) {
    super({ flex });

    this.child = child;
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

    Validator.validateFlexElement(this);

    const result = {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };

    this.child.calculateLayout(result, ctx);

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

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      child: this.child,
    };
  }
}

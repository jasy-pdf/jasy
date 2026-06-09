import { pageFormats } from "../../constants/page-sizes";
import { Orientation } from "../../renderer/pdf-config";
import { Validator } from "../../validators/element-validator";
import {
  PDFElement,
  LayoutConstraints,
  LayoutContext,
  WithChild,
  SizedPDFElement,
} from "../pdf-element";
import type { PDFPageConfig } from "../page-element";

// Padding sizes itself from its child + margin, so it takes no x/y of its own.
interface PaddingElementParams extends WithChild {
  margin: [number, number, number, number];
}

export class PaddingElement extends SizedPDFElement {
  private child: PDFElement;
  private margin: [number, number, number, number];

  constructor({ margin, child }: PaddingElementParams) {
    super({ x: 0, y: 0 });

    this.child = child;
    this.margin = margin;
  }

  calculateLayout(
    parentConstraints: LayoutConstraints | undefined,
    ctx: LayoutContext
  ): LayoutConstraints {
    let result = {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
    if (parentConstraints) {
      if (parentConstraints.width) this.width = parentConstraints.width || 0;
      this.x = parentConstraints.x;
      this.y = parentConstraints.y;

      result = this.adjustDimensionsForPadding(
        this.x,
        this.y,
        this.width!,
        this.height!,
        this.margin
      );
    }

    const childResult = this.child.calculateLayout(result, ctx);
    const [marginTop, _marginRight, marginBottom, _marginLeft] = this.margin;
    this.height = (childResult.height || 0) + marginTop + marginBottom;

    result.height = this.height;

    Validator.validateSizedElement(this);

    this.normalizeCoordinates(ctx.pageConfig);
    return result;
  }

  adjustDimensionsForPadding(
    x: number,
    y: number,
    width: number,
    height: number,
    margin: [number, number, number, number]
  ): { x: number; y: number; width: number; height: number } {
    const [marginTop, marginRight, marginBottom, marginLeft] = margin;

    // Calculate the new position and size of the child element
    const adjustedX = x + marginLeft; // Move x +marginLeft to right
    const adjustedY = y + marginTop; // Move y +marginTop down - normaly we start in the left-bottom corner. But we transform it to regular left-top corner
    const adjustedWidth = width - marginLeft - marginRight; // The width of the child elements goes smaller
    const adjustedHeight = height - marginTop - marginBottom; // "If" we have a height (normally the padding element will get the height of its children) make the height of children smaller

    return {
      x: adjustedX,
      y: adjustedY,
      width: adjustedWidth,
      height: adjustedHeight,
    };
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
      margin: this.margin,
      child: this.child,
    };
  }
}

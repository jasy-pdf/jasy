import { Validator } from "../../validators/element-validator";
import {
  PDFElement,
  LayoutConstraints,
  LayoutContext,
  FlexiblePDFElement,
  WithChild,
  FlexibleElement,
} from "../pdf-element";

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

    // Top-left coordinates; the Y-flip now happens once at the IR -> backend seam.
    return result;
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

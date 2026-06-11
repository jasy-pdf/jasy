import { Validator } from "../../validators/element-validator";
import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
  WithChild,
  FlexibleElement,
} from "../pdf-element";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints";

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
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    if (constraints.hasBoundedHeight) this.height = constraints.maxHeight;
    // Absolute placement from the parent; assignment (not +=) so re-layout is idempotent.
    this.x = offset.x;
    this.y = offset.y;

    Validator.validateFlexElement(this);

    this.child.calculateLayout(
      BoxConstraints.loose(this.width, this.height),
      { x: this.x, y: this.y },
      ctx
    );

    // Top-left coordinates; the Y-flip now happens once at the IR -> backend seam.
    return { width: this.width, height: this.height };
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

import { PageElement } from "./page-element";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import { LayoutContext, PDFElement, WithChildren } from "./pdf-element";

interface PDFDocumentParams extends WithChildren {
  children: PageElement[];
}
export class PDFDocumentElement extends PDFElement {
  private children: PageElement[];

  constructor({ children }: PDFDocumentParams) {
    super();
    this.children = children;
  }

  calculateLayout(_constraints: BoxConstraints, _offset: Offset, ctx: LayoutContext): Size {
    // The document is the root: each page derives its own geometry, so it ignores the
    // incoming constraints/offset. It has no size of its own.
    const origin: Offset = { x: 0, y: 0 };
    this.children.forEach((child) => child.calculateLayout(new BoxConstraints(), origin, ctx));
    return { width: 0, height: 0 };
  }

  override getProps(): PDFDocumentParams {
    return { children: this.children };
  }
}

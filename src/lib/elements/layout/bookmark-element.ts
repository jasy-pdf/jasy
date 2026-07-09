import { PDFElement, LayoutContext } from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";

/**
 * Adds a document-outline entry (a bookmark) that jumps to its child. Layout-transparent: it delegates
 * `calculateLayout` to the child and records the child's top, which the renderer turns into an `Outline`
 * IR node (and PDFRenderer into a /Outlines tree entry). `title` is the label shown in the viewer's
 * bookmark panel; `level` (1-based, default 1) nests it under the nearest preceding smaller level. It
 * draws nothing - the child renders exactly as it would without the bookmark.
 */
export class BookmarkElement extends PDFElement {
  private title: string;
  private level: number;
  private child: PDFElement;
  private y = 0;

  constructor({ title, level = 1, child }: { title: string; level?: number; child: PDFElement }) {
    super();
    this.title = title;
    this.level = level;
    this.child = child;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    const size = this.child.calculateLayout(constraints, offset, ctx);
    this.y = offset.y; // the child's top - the scroll target for the bookmark
    return size;
  }

  override getProps() {
    return {
      title: this.title,
      level: this.level,
      child: this.child,
      y: this.y,
    };
  }
}

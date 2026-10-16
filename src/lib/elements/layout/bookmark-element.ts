import { PDFElement } from "../pdf-element.ts";
import { ProxyElement } from "./proxy-element.ts";

/**
 * Adds a document-outline entry (a bookmark) that jumps to its child. Layout-transparent (a
 * `ProxyElement`); the renderer turns the child's top into an `Outline` IR node (and PDFRenderer into a
 * /Outlines tree entry). `title` is the label shown in the viewer's bookmark panel; `level` (1-based,
 * default 1) nests it under the nearest preceding smaller level. It draws nothing. Split across pages,
 * only the first piece carries the entry - a chapter is listed once.
 */
export class BookmarkElement extends ProxyElement {
  private title: string;
  private level: number;

  constructor({ title, level = 1, child }: { title: string; level?: number; child: PDFElement }) {
    super(child);
    this.title = title;
    this.level = level;
  }

  protected override rewrap(child: PDFElement, continued: boolean): PDFElement {
    return continued ? child : new BookmarkElement({ title: this.title, level: this.level, child });
  }

  override getProps() {
    return { title: this.title, level: this.level, child: this.child, y: this.y };
  }
}

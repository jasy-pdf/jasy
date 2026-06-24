import { PageElement } from "./page-element.ts";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";
import { LayoutContext, PDFElement, WithChildren } from "./pdf-element.ts";
import type { ResolvedTextStyle } from "../text/text-style.ts";

interface PDFDocumentParams extends WithChildren {
  children: PageElement[];
  /** Document-level text defaults descendants inherit (seeded into the layout-context root). */
  defaultTextStyle?: Partial<ResolvedTextStyle>;
}
export class PDFDocumentElement extends PDFElement {
  private children: PageElement[];
  private defaultTextStyle?: Partial<ResolvedTextStyle>;

  constructor({ children, defaultTextStyle }: PDFDocumentParams) {
    super();
    this.children = children;
    this.defaultTextStyle = defaultTextStyle;
  }

  /** The document-level text defaults; the renderer merges them into the cascade root. */
  getDefaultTextStyle(): Partial<ResolvedTextStyle> | undefined {
    return this.defaultTextStyle;
  }

  calculateLayout(_constraints: BoxConstraints, _offset: Offset, ctx: LayoutContext): Size {
    // The document is the root: each page derives its own geometry, so it ignores the
    // incoming constraints/offset. It has no size of its own.
    const origin: Offset = { x: 0, y: 0 };
    this.children.forEach((child) => child.calculateLayout(new BoxConstraints(), origin, ctx));
    return { width: 0, height: 0 };
  }

  override getProps(): PDFDocumentParams {
    return { children: this.children, defaultTextStyle: this.defaultTextStyle };
  }
}

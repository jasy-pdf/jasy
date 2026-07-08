import { PDFElement, LayoutContext } from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";

/**
 * Makes its child a clickable hyperlink. `href` is an external URL; `dest` is an internal named
 * destination (an `Anchor` elsewhere in the document) - exactly one is set. Layout-transparent: it
 * delegates `calculateLayout` to the child and records the resulting box, which the renderer turns into
 * a `Link` IR node (and the page renderer into a /Link annotation). The link draws nothing itself -
 * style the child (e.g. a blue Text) if you want it to look like a link.
 */
export class LinkElement extends PDFElement {
  private href?: string;
  private dest?: string;
  private child: PDFElement;
  private x = 0;
  private y = 0;
  private width = 0;
  private height = 0;

  constructor({ href, dest, child }: { href?: string; dest?: string; child: PDFElement }) {
    super();
    this.href = href;
    this.dest = dest;
    this.child = child;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    const size = this.child.calculateLayout(constraints, offset, ctx);
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  override getProps() {
    return {
      href: this.href,
      dest: this.dest,
      child: this.child,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
    };
  }
}

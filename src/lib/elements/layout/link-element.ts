import { PDFElement } from "../pdf-element.ts";
import { ProxyElement } from "./proxy-element.ts";

/**
 * Makes its child a clickable hyperlink. `href` is an external URL; `dest` is an internal named
 * destination (an `Anchor` elsewhere in the document) - exactly one is set. Layout-transparent (a
 * `ProxyElement`); the renderer turns the child's box into a `Link` IR node (and the page renderer into
 * a /Link annotation). The link draws nothing itself - style the child (e.g. a blue Text) if you want it
 * to look like a link. Split across pages, every piece stays clickable.
 */
export class LinkElement extends ProxyElement {
  private href?: string;
  private dest?: string;

  constructor({ href, dest, child }: { href?: string; dest?: string; child: PDFElement }) {
    super(child);
    this.href = href;
    this.dest = dest;
  }

  protected override rewrap(child: PDFElement): PDFElement {
    return new LinkElement({ href: this.href, dest: this.dest, child });
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

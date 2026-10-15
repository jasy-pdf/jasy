import { PDFElement } from "../pdf-element.ts";
import { ProxyElement } from "./proxy-element.ts";

/**
 * Marks its child as a named jump target for an internal `Link({ to: name })`. Layout-transparent (a
 * `ProxyElement`); the renderer turns the child's top into an `Anchor` IR node (and PDFRenderer into a
 * /Names /Dests entry). It draws nothing. Split across pages, only the first piece is the target - a
 * name must lead to one place.
 */
export class AnchorElement extends ProxyElement {
  private name: string;

  constructor({ name, child }: { name: string; child: PDFElement }) {
    super(child);
    this.name = name;
  }

  protected override rewrap(child: PDFElement, continued: boolean): PDFElement {
    return continued ? child : new AnchorElement({ name: this.name, child });
  }

  override getProps() {
    return { name: this.name, child: this.child, y: this.y };
  }
}

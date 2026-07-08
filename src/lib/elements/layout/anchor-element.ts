import { PDFElement, LayoutContext } from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";

/**
 * Marks its child as a named jump target for an internal `Link({ to: name })`. Layout-transparent: it
 * delegates `calculateLayout` to the child and records the child's top, which the renderer turns into an
 * `Anchor` IR node (and PDFRenderer into a /Names /Dests entry). It draws nothing - the child renders
 * exactly as it would on its own.
 */
export class AnchorElement extends PDFElement {
  private name: string;
  private child: PDFElement;
  private y = 0;

  constructor({ name, child }: { name: string; child: PDFElement }) {
    super();
    this.name = name;
    this.child = child;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    const size = this.child.calculateLayout(constraints, offset, ctx);
    this.y = offset.y; // the child's top - the scroll target for a link that jumps here
    return size;
  }

  override getProps() {
    return {
      name: this.name,
      child: this.child,
      y: this.y,
    };
  }
}

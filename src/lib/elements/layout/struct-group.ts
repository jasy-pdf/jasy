import { PDFElement } from "../pdf-element.ts";
import { ProxyElement } from "./proxy-element.ts";

/**
 * A layout-transparent wrapper (a `ProxyElement`) that assigns an accessibility structure role
 * (Table / TR / TH / TD / …) to its single child; only its renderer opens a structure element and nests
 * the child's tags underneath.
 *
 * Split across pages, the pieces share this group's `structId`, so it stays ONE logical structure
 * element (a table broken over pages is a single <Table>, exactly as Acrobat produces).
 */
export class StructGroup extends ProxyElement {
  private role: string;

  constructor({ role, child }: { role: string; child: PDFElement }) {
    super(child);
    this.role = role;
  }

  protected override rewrap(child: PDFElement): PDFElement {
    return new StructGroup({ role: this.role, child });
  }

  override getProps() {
    return { role: this.role, child: this.child };
  }
}

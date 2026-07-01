import { PDFElement, LayoutContext } from "../pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { Fragmentable, FragmentResult, isFragmentable } from "../../layout/fragmentation.ts";

/**
 * A layout-TRANSPARENT wrapper that assigns an accessibility structure role (Table / TR / TH / TD / …) to
 * its single child. It delegates ALL layout and fragmentation to the child, so the visual result is byte-
 * identical; only its renderer opens a structure element and nests the child's tags underneath.
 *
 * Split across pages, the fitted and remainder halves share this group's `structId`, so it stays ONE
 * logical structure element (a table broken over pages is a single <Table>, exactly as Acrobat produces).
 */
export class StructGroup extends PDFElement implements Fragmentable {
  constructor(
    readonly role: string,
    private child: PDFElement,
  ) {
    super();
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    return this.child.calculateLayout(constraints, offset, ctx);
  }

  /** Only splittable when the wrapped child is - so a StructGroup(Row) is moved whole to the next page,
   *  not clipped at the boundary (isFragmentable honours this veto). */
  canFragment(): boolean {
    return isFragmentable(this.child);
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    if (!isFragmentable(this.child)) return { fitted: null, remainder: this };
    const { fitted, remainder } = this.child.fragment(maxHeight, width, ctx);
    // Re-wrap each half with the SAME role + identity, so both pages point at one structure element.
    return {
      fitted: fitted ? new StructGroup(this.role, fitted).adoptStructId(this) : null,
      remainder: remainder ? new StructGroup(this.role, remainder).adoptStructId(this) : null,
    };
  }

  override getProps() {
    return { role: this.role, child: this.child };
  }
}

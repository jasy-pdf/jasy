import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PageBreakElement } from "../elements/layout/page-break-element.ts";
import { IRNode } from "../ir/display-list.ts";

/**
 * A `PageBreak` draws nothing - the pagination packer consumes it at the cut, so in a vertical flow it
 * never reaches this pass. Reaching it therefore means the break was ineffective: it sat somewhere that
 * does not paginate, like inside a horizontal `Row` (a row is one line, you cannot split it across
 * pages - CSS and react-pdf ignore a forced break there too). We degrade to drawing nothing, but warn
 * once so the mistake is not silent. This one choke-point catches every ineffective break; no element
 * needs a special case.
 */
export class PageBreakRenderer {
  static async render(
    _element: PageBreakElement,
    _objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    console.warn(
      "PageBreak had no effect: it is not in a paginating flow (e.g. it is inside a Row, which is a " +
        "single horizontal line). Put the break as a sibling in a Column to break after that content.",
    );
    return [];
  }
}

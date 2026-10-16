import type { RenderScope } from "../utils/renderer-registry.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PageBreakElement } from "../elements/layout/page-break-element.ts";
import { IRNode } from "../ir/display-list.ts";

/**
 * A `PageBreak` draws nothing - the pagination packer consumes it at the cut, so in a vertical flow it
 * never reaches this pass. Reaching it therefore means the break was ineffective: it sat somewhere that
 * does not paginate - inside a horizontal `Row` (one line; CSS and react-pdf ignore a forced break there
 * too), or inside a `PageBuilder`, whose content is built for the page it lands on and placed whole. We
 * degrade to drawing nothing, but warn so the mistake is not silent. This one choke-point catches every
 * ineffective break; no element needs a special case.
 */
export class PageBreakRenderer {
  static async render(
    _element: PageBreakElement,
    _objectManager: PDFObjectManager,
    _scope: RenderScope,
  ): Promise<IRNode[]> {
    console.warn(
      "PageBreak had no effect: it is not in a paginating flow - it is inside a Row (a single " +
        "horizontal line) or a PageBuilder (built for one page and placed whole). Put the break as a " +
        "sibling in a Column to break after that content.",
    );
    return [];
  }
}

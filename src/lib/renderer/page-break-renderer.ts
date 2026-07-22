import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PageBreakElement } from "../elements/layout/page-break-element.ts";
import { IRNode } from "../ir/display-list.ts";

/**
 * A `PageBreak` draws nothing - the pagination packer consumes it at the cut, so it normally never
 * reaches this pass. This renderer exists only so a stray break (e.g. one placed where it cannot take
 * effect, like inside a `Row`) degrades to drawing nothing instead of tripping the registry.
 */
export class PageBreakRenderer {
  static async render(
    _element: PageBreakElement,
    _objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    return [];
  }
}

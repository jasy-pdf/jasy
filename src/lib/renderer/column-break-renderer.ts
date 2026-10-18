import type { RenderScope } from "../utils/renderer-registry.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { ColumnBreakElement } from "../elements/layout/column-break-element.ts";
import { IRNode } from "../ir/display-list.ts";

/** A `ColumnBreak` that reaches this pass was nowhere a Flow could break at it - it had no effect. */
export class ColumnBreakRenderer {
  static async render(
    element: ColumnBreakElement,
    objectManager: PDFObjectManager,
    _scope: RenderScope,
  ): Promise<IRNode[]> {
    objectManager.diagnostics.report({
      code: "column-break-ignored",
      severity: "warning",
      message:
        "ColumnBreak had no effect: it breaks only where a Flow's content runs down a Region - not " +
        "outside a Flow, and not in a Row or a table row, which never break. To start a new page, " +
        "use PageBreak.",
      about: element,
      page: element.page,
    });
    return [];
  }
}

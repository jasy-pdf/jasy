import type { RenderScope } from "../utils/renderer-registry.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { ColumnBreakElement } from "../elements/layout/column-break-element.ts";
import { IRNode } from "../ir/display-list.ts";

/** A `ColumnBreak` that reaches this pass was not in a Region of a Flow - it had no effect. */
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
        "ColumnBreak had no effect: it is not inside a Region of a Flow. It moves content to the " +
        "next Region; to start a new page, use PageBreak.",
      about: element,
      page: element.page,
    });
    return [];
  }
}

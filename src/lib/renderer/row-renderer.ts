import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RowElement } from "../elements/row-element.ts";
import { RendererRegistry, within, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class RowRenderer {
  static async render(
    rowElement: RowElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x, y, children } = rowElement.getProps();
    const nodes: IRNode[] = [];
    // Its children are placed relative to its own top-left.
    const inner = within(scope, { x, y });

    if (children)
      for (const child of children) {
        const renderer = RendererRegistry.getRenderer(child);
        nodes.push(...(await renderer(child, objectManager, inner)));
      }

    return nodes;
  }
}

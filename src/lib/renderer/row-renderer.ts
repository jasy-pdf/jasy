import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RowElement } from "../elements/row-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class RowRenderer {
  static async render(rowElement: RowElement, objectManager: PDFObjectManager): Promise<IRNode[]> {
    const { children } = rowElement.getProps();
    const nodes: IRNode[] = [];

    if (children)
      for (const child of children) {
        const renderer = RendererRegistry.getRenderer(child);
        if (renderer) {
          nodes.push(...(await renderer(child, objectManager)));
        }
      }

    return nodes;
  }
}

import { PDFObjectManager } from "../utils/pdf-object-manager";
import { RowElement } from "../elements/row-element";
import { RendererRegistry } from "../utils/renderer-registry";
import { IRNode } from "../ir/display-list";

export class RowRenderer {
  static async render(
    rowElement: RowElement,
    objectManager: PDFObjectManager
  ): Promise<IRNode[]> {
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

import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RowElement } from "../elements/row-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class RowRenderer {
  static async render(
    rowElement: RowElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { children } = rowElement.getProps();
    const nodes: IRNode[] = [];

    if (children)
      for (const child of children) {
        const renderer = RendererRegistry.getRenderer(child);
        nodes.push(...(await renderer(child, objectManager, scope)));
      }

    return nodes;
  }
}

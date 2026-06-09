import { PDFObjectManager } from "../utils/pdf-object-manager";
import { ContainerElement } from "../elements/container-element";
import { RendererRegistry } from "../utils/renderer-registry";
import { IRNode } from "../ir/display-list";

export class ContainerRenderer {
  static async render(
    containerElement: ContainerElement,
    objectManager: PDFObjectManager
  ): Promise<IRNode[]> {
    const { children } = containerElement.getProps();
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

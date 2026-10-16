import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { ContainerElement } from "../elements/container-element.ts";
import { RendererRegistry, within, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class ContainerRenderer {
  static async render(
    containerElement: ContainerElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x, y, children } = containerElement.getProps();
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

import { PDFObjectManager } from "../utils/pdf-object-manager";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element";
import { RendererRegistry } from "../utils/renderer-registry";
import { IRNode } from "../ir/display-list";

export class RepeatingHeaderRenderer {
  static async render(
    element: RepeatingHeaderElement,
    objectManager: PDFObjectManager
  ): Promise<IRNode[]> {
    const { header, body } = element.getProps();
    const nodes: IRNode[] = [];
    for (const child of [header, body]) {
      const renderer = RendererRegistry.getRenderer(child);
      if (renderer) nodes.push(...(await renderer(child, objectManager)));
    }
    return nodes;
  }
}

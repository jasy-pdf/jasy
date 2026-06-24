import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { ExpandedElement } from "../elements/index.ts";
import { IRNode } from "../ir/display-list.ts";

export class ExpandedRenderer {
  static async render(
    expandedElement: ExpandedElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { child } = expandedElement.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    return renderer ? await renderer(child, objectManager) : [];
  }
}

import { PDFObjectManager } from "../utils/pdf-object-manager";
import { RendererRegistry } from "../utils/renderer-registry";
import { ExpandedElement } from "../elements";
import { IRNode } from "../ir/display-list";

export class ExpandedRenderer {
  static async render(
    expandedElement: ExpandedElement,
    objectManager: PDFObjectManager
  ): Promise<IRNode[]> {
    const { child } = expandedElement.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    return renderer ? await renderer(child, objectManager) : [];
  }
}

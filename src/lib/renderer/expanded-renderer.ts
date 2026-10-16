import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { ExpandedElement } from "../elements/index.ts";
import { IRNode } from "../ir/display-list.ts";

export class ExpandedRenderer {
  static async render(
    expandedElement: ExpandedElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { child } = expandedElement.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    return renderer(child, objectManager, scope);
  }
}

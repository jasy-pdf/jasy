import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { PaddingElement } from "../elements/layout/padding-element.ts";
import { IRNode } from "../ir/display-list.ts";

export class PaddingRenderer {
  static async render(
    paddingElement: PaddingElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { child } = paddingElement.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    return renderer(child, objectManager, scope);
  }
}

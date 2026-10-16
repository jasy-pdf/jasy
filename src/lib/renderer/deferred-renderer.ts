import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { DeferredElement } from "../elements/layout/deferred-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class DeferredRenderer {
  static async render(
    element: DeferredElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { composed } = element.getProps();
    if (!composed) return [];
    const renderer = RendererRegistry.getRenderer(composed);
    return renderer(composed, objectManager, scope);
  }
}

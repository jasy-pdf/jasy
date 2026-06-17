import { PDFObjectManager } from "../utils/pdf-object-manager";
import { DeferredElement } from "../elements/layout/deferred-element";
import { RendererRegistry } from "../utils/renderer-registry";
import { IRNode } from "../ir/display-list";

export class DeferredRenderer {
  static async render(
    element: DeferredElement,
    objectManager: PDFObjectManager
  ): Promise<IRNode[]> {
    const { composed } = element.getProps();
    if (!composed) return [];
    const renderer = RendererRegistry.getRenderer(composed);
    return renderer ? renderer(composed, objectManager) : [];
  }
}

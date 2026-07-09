import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PageBuilderElement } from "../elements/layout/page-builder-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class PageBuilderRenderer {
  static async render(
    element: PageBuilderElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    // `composed` is whatever the closure built for THIS page during the render pass's layout.
    const { composed } = element.getProps();
    if (!composed) return [];

    const renderer = RendererRegistry.getRenderer(composed);
    return renderer ? renderer(composed, objectManager) : [];
  }
}

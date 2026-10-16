import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry, within, type RenderScope } from "../utils/renderer-registry.ts";
import { PaddingElement } from "../elements/layout/padding-element.ts";
import { IRNode } from "../ir/display-list.ts";

export class PaddingRenderer {
  static async render(
    paddingElement: PaddingElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x, y, child } = paddingElement.getProps();

    // Its child is placed relative to its own top-left, inset by the margins.
    const renderer = RendererRegistry.getRenderer(child);
    return renderer(child, objectManager, within(scope, { x, y }));
  }
}

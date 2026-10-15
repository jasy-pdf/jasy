import type { Offset } from "../layout/box-constraints.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { PaddingElement } from "../elements/layout/padding-element.ts";
import { IRNode } from "../ir/display-list.ts";

export class PaddingRenderer {
  static async render(
    paddingElement: PaddingElement,
    objectManager: PDFObjectManager,
    origin: Offset,
  ): Promise<IRNode[]> {
    const { child } = paddingElement.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    return renderer(child, objectManager, origin);
  }
}

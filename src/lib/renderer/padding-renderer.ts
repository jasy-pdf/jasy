import { PDFObjectManager } from "../utils/pdf-object-manager";
import { RendererRegistry } from "../utils/renderer-registry";
import { PaddingElement } from "../elements/layout/padding-element";
import { IRNode } from "../ir/display-list";

export class PaddingRenderer {
  static async render(
    paddingElement: PaddingElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { child } = paddingElement.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    return renderer ? await renderer(child, objectManager) : [];
  }
}

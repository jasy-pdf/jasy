import { PDFObjectManager } from "../utils/pdf-object-manager";
import { RendererRegistry } from "../utils/renderer-registry";
import { DefaultTextStyleElement } from "../elements/layout/default-text-style-element";
import { IRNode } from "../ir/display-list";

// Transparent wrapper: the text style was already resolved onto the descendants at layout time, so
// the renderer just emits the child's display list (like PaddingRenderer).
export class DefaultTextStyleRenderer {
  static async render(
    element: DefaultTextStyleElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { child } = element.getProps();
    const renderer = RendererRegistry.getRenderer(child);
    return renderer ? await renderer(child, objectManager) : [];
  }
}

import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { DefaultTextStyleElement } from "../elements/layout/default-text-style-element.ts";
import { IRNode } from "../ir/display-list.ts";

// Transparent wrapper: the text style was already resolved onto the descendants at layout time, so
// the renderer just emits the child's display list (like PaddingRenderer).
export class DefaultTextStyleRenderer {
  static async render(
    element: DefaultTextStyleElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { child } = element.getProps();
    const renderer = RendererRegistry.getRenderer(child);
    return renderer(child, objectManager, scope);
  }
}

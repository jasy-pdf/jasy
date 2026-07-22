import { KeepTogetherElement } from "../elements/layout/keep-together-element.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { IRNode } from "../ir/display-list.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";

/**
 * A `keepTogether` is layout-transparent: it just renders its child. All of its work happens in the
 * layout pass (`fragment`), never here.
 */
export class KeepTogetherRenderer {
  static async render(
    group: KeepTogetherElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { child } = group.getProps();
    const renderer = RendererRegistry.getRenderer(child);
    return renderer ? await renderer(child, objectManager) : [];
  }
}

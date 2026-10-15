import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PositionedElement } from "../elements/layout/positioned-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class PositionedRenderer {
  /**
   * Drawn at its own place in the tree (tree order is paint order), from its frame: the child was laid
   * out relative to the frame's top-left, not to the flow it sits in.
   */
  static async render(
    positionedElement: PositionedElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { child } = positionedElement.getProps();
    const renderer = RendererRegistry.getRenderer(child);
    return renderer(child, objectManager, { ...scope, origin: scope.frame });
  }
}

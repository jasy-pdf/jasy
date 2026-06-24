import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PositionedElement } from "../elements/layout/positioned-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class PositionedRenderer {
  static async render(
    positionedElement: PositionedElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    // The child was already placed (by the frame) during layout; just emit its IR. It is drawn
    // after the frame's flow content, so it paints on top.
    const { child } = positionedElement.getProps();
    const renderer = RendererRegistry.getRenderer(child);
    return renderer ? renderer(child, objectManager) : [];
  }
}

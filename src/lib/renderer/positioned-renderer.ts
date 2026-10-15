import type { Offset } from "../layout/box-constraints.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PositionedElement } from "../elements/layout/positioned-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class PositionedRenderer {
  /** Out of flow: nothing is drawn where it sits in the tree. Its frame draws it (`renderPlaced`). */
  static async render(
    _positionedElement: PositionedElement,
    _objectManager: PDFObjectManager,
    _origin: Offset,
  ): Promise<IRNode[]> {
    return [];
  }

  /**
   * A frame's out-of-flow content, drawn after its flow content so it lies on top (CSS paint order),
   * in tree order. `frameOrigin` is the frame's absolute top-left; the placements are relative to it.
   */
  static async renderPlaced(
    placed: readonly PositionedElement[],
    objectManager: PDFObjectManager,
    frameOrigin: Offset,
  ): Promise<IRNode[]> {
    const nodes: IRNode[] = [];
    for (const p of placed) {
      const { child } = p.getProps();
      nodes.push(...(await RendererRegistry.getRenderer(child)(child, objectManager, frameOrigin)));
    }
    return nodes;
  }
}

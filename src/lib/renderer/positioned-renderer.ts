import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PositionedElement, stackedIn } from "../elements/layout/positioned-element.ts";
import type { PDFElement } from "../elements/pdf-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class PositionedRenderer {
  /**
   * Drawn at its own place in the tree (tree order is paint order), from its frame: the child was laid
   * out relative to the frame's top-left, not to the flow it sits in. One with a `zIndex` draws nothing
   * here - its stacking context paints it (`paintStacked`).
   */
  static async render(
    positionedElement: PositionedElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    if (positionedElement.zIndex !== 0) return [];
    return PositionedRenderer.paint(positionedElement, objectManager, scope);
  }

  private static paint(
    positionedElement: PositionedElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { child } = positionedElement.getProps();
    return RendererRegistry.render(child, objectManager, { ...scope, origin: scope.frame });
  }

  /**
   * Paints the children of a stacking context (a frame, a clipping Box, a rotation, the page): its
   * `Positioned` with a negative `zIndex` first, then the children in tree order, then the positive
   * ones - lowest first, ties in tree order. Without a `zIndex` below it, this is the children in order.
   */
  static async paintStacked(
    children: readonly PDFElement[],
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const stacked = stackedIn(children).sort((a, b) => a.zIndex - b.zIndex); // a stable sort
    const nodes: IRNode[] = [];
    for (const p of stacked.filter((p) => p.zIndex < 0))
      nodes.push(...(await PositionedRenderer.paint(p, objectManager, scope)));
    nodes.push(...(await PositionedRenderer.paintInOrder(children, objectManager, scope)));
    for (const p of stacked.filter((p) => p.zIndex > 0))
      nodes.push(...(await PositionedRenderer.paint(p, objectManager, scope)));
    return nodes;
  }

  /** Children in tree order - what any element that is not a stacking context draws. */
  static async paintInOrder(
    children: readonly PDFElement[],
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const nodes: IRNode[] = [];
    for (const child of children)
      nodes.push(...(await RendererRegistry.render(child, objectManager, scope)));
    return nodes;
  }
}

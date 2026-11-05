import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PositionedElement } from "../elements/layout/positioned-element.ts";
import type { PDFElement } from "../elements/pdf-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class PositionedRenderer {
  /**
   * Rendered at its own place in the tree, from its frame: the child was laid out relative to the
   * frame's top-left, not to the flow it sits in. Without a `zIndex` that place is also where it paints.
   * With one it hands its drawing to the nearest stacking context (`paintStacked`), which sorts it - so
   * tagging and everything else registered while rendering still sees the tree it stands in.
   */
  static async render(
    positionedElement: PositionedElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { child, zIndex } = positionedElement.getProps();
    const render = () =>
      RendererRegistry.render(child, objectManager, { ...scope, origin: scope.frame });
    if (zIndex === 0 || !scope.stacked) return render();
    // Its place in the stack is taken BEFORE its child renders: a nested Positioned with the same
    // zIndex hands its drawing in during that, and must come after its outer one, in tree order.
    const entry = { zIndex, nodes: [] as IRNode[] };
    scope.stacked.push(entry);
    entry.nodes = await render();
    return [];
  }

  /**
   * Paints the children of a stacking context (a frame, a clipping Box, a rotation, the page): the
   * `Positioned` below it with a negative `zIndex` first, then the children in tree order, then the
   * positive ones - lowest first, ties in tree order. Without a `zIndex` below it, this is the children
   * in order.
   */
  static async paintStacked(
    children: readonly PDFElement[],
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const stacked: { zIndex: number; nodes: IRNode[] }[] = [];
    const flow = await PositionedRenderer.paintInOrder(children, objectManager, {
      ...scope,
      stacked,
    });
    stacked.sort((a, b) => a.zIndex - b.zIndex); // stable: ties keep tree order
    return [
      ...stacked.filter((s) => s.zIndex < 0).flatMap((s) => s.nodes),
      ...flow,
      ...stacked.filter((s) => s.zIndex > 0).flatMap((s) => s.nodes),
    ];
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

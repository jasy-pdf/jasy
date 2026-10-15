import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element.ts";
import { RendererRegistry, within, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class RepeatingHeaderRenderer {
  static async render(
    element: RepeatingHeaderElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x, y, header, body } = element.getProps();
    const nodes: IRNode[] = [];
    // Header and body are placed relative to its own top-left.
    const inner = within(scope, { x, y });
    for (const child of [header, body]) {
      const renderer = RendererRegistry.getRenderer(child);
      nodes.push(...(await renderer(child, objectManager, inner)));
    }
    return nodes;
  }
}

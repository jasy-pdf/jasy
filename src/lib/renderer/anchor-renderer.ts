import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { AnchorElement } from "../elements/layout/anchor-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class AnchorRenderer {
  static async render(
    element: AnchorElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { name, child, y: ownY } = element.getProps();
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const y = scope.origin.y + (ownY ?? 0);

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = await renderer(child, objectManager, scope);

    // The child draws normally; an Anchor IR node carries the name + scroll target for the page renderer
    // to register as a named destination (it produces no content-stream ops itself).
    return [...childNodes, { type: "anchor", y, name }];
  }
}

import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { LinkElement } from "../elements/layout/link-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class LinkRenderer {
  static async render(
    element: LinkElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { href, dest, child, x: ownX, y: ownY, width, height } = element.getProps();
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const x = scope.origin.x + (ownX ?? 0);
    const y = scope.origin.y + (ownY ?? 0);

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = await renderer(child, objectManager, scope);

    // The child draws normally; a Link IR node carries the clickable rect + target (external href or
    // internal dest) for the page renderer to emit as a /Link annotation (no content-stream ops itself).
    return [...childNodes, { type: "link", x, y, width, height, href, dest }];
  }
}

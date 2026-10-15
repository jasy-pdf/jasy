import type { Offset } from "../layout/box-constraints.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { LinkElement } from "../elements/layout/link-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class LinkRenderer {
  static async render(
    element: LinkElement,
    objectManager: PDFObjectManager,
    origin: Offset,
  ): Promise<IRNode[]> {
    const { href, dest, child, x: ownX, y: ownY, width, height } = element.getProps();
    // Its own position is relative to `origin`; the IR wants page coordinates.
    const x = origin.x + (ownX ?? 0);
    const y = origin.y + (ownY ?? 0);

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = await renderer(child, objectManager, origin);

    // The child draws normally; a Link IR node carries the clickable rect + target (external href or
    // internal dest) for the page renderer to emit as a /Link annotation (no content-stream ops itself).
    return [...childNodes, { type: "link", x, y, width, height, href, dest }];
  }
}

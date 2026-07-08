import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { LinkElement } from "../elements/layout/link-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class LinkRenderer {
  static async render(element: LinkElement, objectManager: PDFObjectManager): Promise<IRNode[]> {
    const { href, dest, child, x, y, width, height } = element.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = renderer ? await renderer(child, objectManager) : [];

    // The child draws normally; a Link IR node carries the clickable rect + target (external href or
    // internal dest) for the page renderer to emit as a /Link annotation (no content-stream ops itself).
    return [...childNodes, { type: "link", x, y, width, height, href, dest }];
  }
}

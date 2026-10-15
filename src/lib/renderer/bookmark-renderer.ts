import type { Offset } from "../layout/box-constraints.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { BookmarkElement } from "../elements/layout/bookmark-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class BookmarkRenderer {
  static async render(
    element: BookmarkElement,
    objectManager: PDFObjectManager,
    origin: Offset,
  ): Promise<IRNode[]> {
    const { title, level, child, y: ownY } = element.getProps();
    // Its own position is relative to `origin`; the IR wants page coordinates.
    const y = origin.y + (ownY ?? 0);

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = await renderer(child, objectManager, origin);

    // The child draws normally; an Outline IR node carries the title + nesting + scroll target for the
    // page renderer to collect into the /Outlines tree (it produces no content-stream ops itself).
    return [...childNodes, { type: "outline", y, title, level }];
  }
}

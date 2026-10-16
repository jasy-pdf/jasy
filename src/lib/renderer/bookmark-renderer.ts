import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { BookmarkElement } from "../elements/layout/bookmark-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class BookmarkRenderer {
  static async render(
    element: BookmarkElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { title, level, child, y: ownY } = element.getProps();
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const y = scope.origin.y + (ownY ?? 0);

    const childNodes = await RendererRegistry.render(child, objectManager, scope);

    // The child draws normally; an Outline IR node carries the title + nesting + scroll target for the
    // page renderer to collect into the /Outlines tree (it produces no content-stream ops itself).
    return [...childNodes, { type: "outline", y, title, level }];
  }
}

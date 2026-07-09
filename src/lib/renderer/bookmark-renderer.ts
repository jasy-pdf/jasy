import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { BookmarkElement } from "../elements/layout/bookmark-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class BookmarkRenderer {
  static async render(
    element: BookmarkElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { title, level, child, y } = element.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = renderer ? await renderer(child, objectManager) : [];

    // The child draws normally; an Outline IR node carries the title + nesting + scroll target for the
    // page renderer to collect into the /Outlines tree (it produces no content-stream ops itself).
    return [...childNodes, { type: "outline", y, title, level }];
  }
}

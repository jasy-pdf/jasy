import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { AnchorElement } from "../elements/layout/anchor-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class AnchorRenderer {
  static async render(element: AnchorElement, objectManager: PDFObjectManager): Promise<IRNode[]> {
    const { name, child, y } = element.getProps();

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = renderer ? await renderer(child, objectManager) : [];

    // The child draws normally; an Anchor IR node carries the name + scroll target for the page renderer
    // to register as a named destination (it produces no content-stream ops itself).
    return [...childNodes, { type: "anchor", y, name }];
  }
}

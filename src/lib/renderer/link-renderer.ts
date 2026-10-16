import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { LinkElement } from "../elements/layout/link-element.ts";
import { RendererRegistry, type RenderScope } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";
import type { PDFElement } from "../elements/pdf-element.ts";
import { TextElement } from "../elements/text-element.ts";

/** The text a link covers, as written - not as drawn, where a justified line is one run per word. */
function textOf(element: PDFElement): string[] {
  if (element instanceof TextElement) {
    const { content } = element.getProps();
    return [typeof content === "string" ? content : content.map((s) => s.content).join("")];
  }
  return element.layoutChildren().flatMap(textOf);
}

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

    const renderChild = () => RendererRegistry.render(child, objectManager, scope);

    // The child draws normally; a Link IR node carries the clickable rect + target (external href or
    // internal dest) for the page renderer to emit as a /Link annotation (no content-stream ops itself).
    if (!objectManager.struct.enabled) {
      return [...(await renderChild()), { type: "link", x, y, width, height, href, dest }];
    }

    // Tagged: the link's content sits in a /Link element, which also takes the annotation, and the
    // annotation describes itself by the text it covers (PDF/UA 7.18.5). A split link is ONE element.
    const struct = objectManager.struct;
    const structKey = struct.openElement(element.structId, "Link");
    struct.push(structKey);
    let childNodes: IRNode[];
    try {
      childNodes = await renderChild();
    } finally {
      struct.pop();
    }
    const alt = textOf(child).join(" ").replace(/\s+/g, " ").trim() || (href ?? dest ?? "");
    return [...childNodes, { type: "link", x, y, width, height, href, dest, structKey, alt }];
  }
}

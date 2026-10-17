import type { RenderScope } from "../utils/renderer-registry.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { SvgElement } from "../elements/svg-element.ts";
import type { IRNode } from "../ir/display-list.ts";
import { svgToIr } from "../svg/index.ts";

/**
 * Turns the drawing into display-list nodes inside the box layout gave it. All the work is in
 * `svg/`; this is only the seam, which is why an SVG needs no new IR primitive - the vector layer
 * that colour emoji already draw through carries it.
 */
export class SvgRenderer {
  static async render(
    element: SvgElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    await element.load(); // an SVG from a URL; already done when the pre-layout pass reached it
    const { x: ownX, y: ownY, width, height, source, alt } = element.getProps();
    if (source === undefined) throw new Error("@jasy/pdf: an SVG was drawn before it was loaded");
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const x = scope.origin.x + (ownX ?? 0);
    const y = scope.origin.y + (ownY ?? 0);
    const nodes = svgToIr(source, {
      x: x ?? 0,
      y: y ?? 0,
      width: width ?? 0,
      height: height ?? 0,
    });
    // Accessible tagging: a drawing WITH alt text is one Figure - every path of it belongs to the
    // same struct element, which is what `openElement` keyed on `structId` gives us. Without alt it
    // stays untagged and the backend treats it as decoration (an Artifact).
    if (!alt || !objectManager.struct.enabled) return nodes;
    const tag = {
      role: "Figure",
      key: objectManager.struct.openElement(element.structId, "Figure", { alt }),
    };
    return nodes.map((node) => (node.type === "path" ? { ...node, tag } : node));
  }
}

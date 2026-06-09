import { PDFObjectManager } from "../utils/pdf-object-manager";

import { RectangleElement } from "../elements/rectangle-element";
import { RendererRegistry } from "../utils/renderer-registry";
import { IRNode, Rect } from "../ir/display-list";

export class RectangleRenderer {
  static async render(
    rectangleElement: RectangleElement,
    objectManager: PDFObjectManager
  ): Promise<IRNode[]> {
    const {
      x,
      y,
      width,
      height,
      children,
      color,
      backgroundColor,
      borderWidth,
    } = rectangleElement.getProps();

    // The box itself becomes a display-list primitive. A background means a filled
    // box; otherwise it is stroked only. Children follow the box (Rectangle is also a
    // container), so their nodes are appended after it.
    const node: Rect = {
      type: "rect",
      x,
      y,
      width,
      height: height!,
      stroke: color,
      strokeWidth: borderWidth!,
      ...(backgroundColor ? { fill: backgroundColor } : {}),
    };
    const nodes: IRNode[] = [node];

    if (children)
      for (const child of children) {
        const renderer = RendererRegistry.getRenderer(child);
        if (renderer) {
          nodes.push(...(await renderer(child, objectManager)));
        }
      }

    return nodes;
  }
}

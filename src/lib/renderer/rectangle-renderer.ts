import { PDFObjectManager } from "../utils/pdf-object-manager";

import { RectangleElement, SideBorders } from "../elements/rectangle-element";
import { RendererRegistry } from "../utils/renderer-registry";
import { IRNode, Rect, Line } from "../ir/display-list";
import { Color } from "../common/color";

export class RectangleRenderer {
  static async render(
    rectangleElement: RectangleElement,
    objectManager: PDFObjectManager,
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
      radius,
      sideBorders,
      overflow,
    } = rectangleElement.getProps();

    const h = height!;
    const nodes: IRNode[] = [];

    if (sideBorders) {
      // Per-side borders: a fill-only box (no stroke), then a line per present side
      // (sharp corners). This is what lets cells draw grid lines.
      if (backgroundColor) {
        nodes.push({ type: "rect", x, y, width, height: h, strokeWidth: 0, fill: backgroundColor });
      }
      nodes.push(...RectangleRenderer.sideLines(x, y, width, h, borderWidth!, sideBorders));
    } else {
      // The box itself becomes a display-list primitive. A background means a filled box;
      // otherwise it is stroked only. (Unchanged path - byte-identical.)
      const node: Rect = {
        type: "rect",
        x,
        y,
        width,
        height: h,
        stroke: color,
        strokeWidth: borderWidth!,
        ...(backgroundColor ? { fill: backgroundColor } : {}),
        ...(radius ? { radius } : {}),
      };
      nodes.push(node);
    }

    // Children follow the box (Rectangle is also a container). With overflow: "hidden" they are
    // wrapped in a clip to the (rounded) box rect, so a Positioned child is cropped at the edge
    // instead of spilling over. Default "visible" emits no clip - byte-identical.
    const clip = overflow === "hidden";
    if (clip) {
      nodes.push({ type: "clip-push", x, y, width, height: h, ...(radius ? { radius } : {}) });
    }
    if (children)
      for (const child of children) {
        const renderer = RendererRegistry.getRenderer(child);
        if (renderer) {
          nodes.push(...(await renderer(child, objectManager)));
        }
      }
    if (clip) nodes.push({ type: "clip-pop" });

    return nodes;
  }

  /** One `line` node per present side, along the box edges (top-left coordinates). */
  private static sideLines(
    x: number,
    y: number,
    width: number,
    height: number,
    strokeWidth: number,
    sides: SideBorders,
  ): Line[] {
    const lines: Line[] = [];
    const add = (x1: number, y1: number, x2: number, y2: number, stroke?: Color) => {
      if (stroke) lines.push({ type: "line", x1, y1, x2, y2, stroke, strokeWidth });
    };
    add(x, y, x + width, y, sides.top); // top
    add(x, y + height, x + width, y + height, sides.bottom); // bottom
    add(x, y, x, y + height, sides.left); // left
    add(x + width, y, x + width, y + height, sides.right); // right
    return lines;
  }
}

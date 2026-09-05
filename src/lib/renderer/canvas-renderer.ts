import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { CanvasElement } from "../elements/canvas-element.ts";
import { CanvasPainter } from "../canvas/painter.ts";
import type { IRNode } from "../ir/display-list.ts";

/**
 * Runs the caller's paint callback and hands back what it drew.
 *
 * The painter works in CANVAS coordinates (0,0 is the box's own corner), so the whole drawing is
 * wrapped in one translate rather than every point being offset - the same shape `Svg` uses, and it
 * keeps the callback independent of where the box ended up. The clip is the box: a drawing that runs
 * past its own edge would otherwise bleed into the layout beside it.
 */
export class CanvasRenderer {
  static async render(element: CanvasElement, objectManager: PDFObjectManager): Promise<IRNode[]> {
    const { x, y, width, height, paint, alt } = element.getProps();
    const box = { width: width ?? 0, height: height ?? 0 };

    const painter = new CanvasPainter(box);
    paint(painter, box);
    const drawn = painter.drawn();

    const nodes: IRNode[] = [
      { type: "clip-push", x: x ?? 0, y: y ?? 0, width: box.width, height: box.height },
      { type: "transform-push", matrix: [1, 0, 0, 1, x ?? 0, y ?? 0] },
      ...drawn,
      { type: "transform-pop" },
      { type: "clip-pop" },
    ];

    if (!alt || !objectManager.struct.enabled) return nodes;
    const tag = {
      role: "Figure",
      key: objectManager.struct.openElement(element.structId, "Figure", { alt }),
    };
    return nodes.map((node) => (node.type === "path" ? { ...node, tag } : node));
  }
}

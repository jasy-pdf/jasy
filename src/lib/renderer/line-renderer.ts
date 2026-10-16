import type { RenderScope } from "../utils/renderer-registry.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { LineElement } from "../elements/index.ts";
import { IRNode, Line } from "../ir/display-list.ts";

export class LineRenderer {
  static async render(
    lineElement: LineElement,
    _objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const {
      x: ownX,
      y: ownY,
      xEnd: ownXEnd,
      yEnd: ownYEnd,
      color,
      strokeWidth,
    } = lineElement.getProps();
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const x = scope.origin.x + (ownX ?? 0);
    const y = scope.origin.y + (ownY ?? 0);
    const xEnd = scope.origin.x + (ownXEnd ?? 0);
    const yEnd = scope.origin.y + (ownYEnd ?? 0);

    const node: Line = {
      type: "line",
      x1: x,
      y1: y,
      x2: xEnd,
      y2: yEnd!,
      stroke: color!,
      strokeWidth: strokeWidth!,
    };

    return [node];
  }
}

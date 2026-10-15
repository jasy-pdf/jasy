import type { Offset } from "../layout/box-constraints.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { LineElement } from "../elements/index.ts";
import { IRNode, Line } from "../ir/display-list.ts";

export class LineRenderer {
  static async render(
    lineElement: LineElement,
    _objectManager: PDFObjectManager,
    origin: Offset,
  ): Promise<IRNode[]> {
    const {
      x: ownX,
      y: ownY,
      xEnd: ownXEnd,
      yEnd: ownYEnd,
      color,
      strokeWidth,
    } = lineElement.getProps();
    // Its own position is relative to `origin`; the IR wants page coordinates.
    const x = origin.x + (ownX ?? 0);
    const y = origin.y + (ownY ?? 0);
    const xEnd = origin.x + (ownXEnd ?? 0);
    const yEnd = origin.y + (ownYEnd ?? 0);

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

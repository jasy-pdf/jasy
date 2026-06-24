import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { LineElement } from "../elements/index.ts";
import { IRNode, Line } from "../ir/display-list.ts";

export class LineRenderer {
  static async render(
    lineElement: LineElement,
    _objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { x, y, xEnd, yEnd, color, strokeWidth } = lineElement.getProps();

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

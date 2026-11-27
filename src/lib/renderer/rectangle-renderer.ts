import { PDFObjectManager } from "../utils/pdf-object-manager.ts";

import { RectangleElement } from "../elements/rectangle-element.ts";
import type { RenderScope } from "../utils/renderer-registry.ts";
import { IRNode, Rect } from "../ir/display-list.ts";
import { sideBorderNodes } from "./side-borders.ts";
import { PositionedRenderer } from "./positioned-renderer.ts";
import { isGradientInput, resolveGradient } from "../common/gradient.ts";

export class RectangleRenderer {
  static async render(
    rectangleElement: RectangleElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const {
      x: ownX,
      y: ownY,
      width,
      height,
      children,
      color,
      backgroundColor,
      borderWidth,
      radius,
      sideBorders,
      overflow,
      relative,
    } = rectangleElement.getProps();
    // Its own position is relative to `scope.origin`; the IR wants page coordinates.
    const x = scope.origin.x + (ownX ?? 0);
    const y = scope.origin.y + (ownY ?? 0);

    const h = height!;
    const nodes: IRNode[] = [];

    // A gradient is written box-relative (an angle and stops); this is the first place the box is
    // known, so it is resolved into the absolute page coordinates the IR wants.
    const fill =
      backgroundColor !== undefined && isGradientInput(backgroundColor)
        ? resolveGradient(backgroundColor, x, y, width, h)
        : backgroundColor;

    if (sideBorders) {
      // Per-side borders: a fill-only box (no stroke), then the present sides on their own.
      if (backgroundColor) {
        nodes.push({
          type: "rect",
          x,
          y,
          width,
          height: h,
          strokeWidth: 0,
          fill,
          ...(radius ? { radius } : {}),
        });
      }
      nodes.push(...sideBorderNodes(x, y, width, h, borderWidth!, sideBorders, radius));
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
        ...(fill ? { fill } : {}),
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
    // Its children are placed relative to its own top-left; a `relative` box is also the frame its
    // `Positioned` descendants were placed against.
    const childScope: RenderScope = {
      ...scope,
      origin: { x, y },
      frame: relative ? { x, y } : scope.frame,
    };
    // A frame or a clip paints its own `zIndex` order; any other box draws its children as they come.
    if (children)
      nodes.push(
        ...(rectangleElement.isStackingContext()
          ? await PositionedRenderer.paintStacked(children, objectManager, childScope)
          : await PositionedRenderer.paintInOrder(children, objectManager, childScope)),
      );
    if (clip) nodes.push({ type: "clip-pop" });

    return nodes;
  }
}

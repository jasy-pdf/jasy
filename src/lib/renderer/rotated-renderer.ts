import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RotatedElement } from "../elements/layout/rotated-element.ts";
import { RotatedBoxElement } from "../elements/layout/rotated-box-element.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { IRNode } from "../ir/display-list.ts";

export class RotatedRenderer {
  // Both `Rotated` (paint-only) and `RotatedBox` (layout-aware quarter-turns) expose the same
  // `{ angle, child, x, y, width, height }` and rotate the child around the box center - shared here.
  static async render(
    element: RotatedElement | RotatedBoxElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const { angle, child, x, y, width, height } = element.getProps();

    // Rotate around the box CENTER, in the engine's top-left coordinates (the IR->backend seam flips
    // the matrix to PDF space per page). A positive angle reads clockwise on the page.
    const cx = x + width / 2;
    const cy = y + height / 2;
    const theta = (angle * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // M = T(cx,cy) · R(theta) · T(-cx,-cy) as a PDF cm [a,b,c,d,e,f]: the linear part is the rotation,
    // the translation keeps the center fixed.
    const matrix: [number, number, number, number, number, number] = [
      cos,
      sin,
      -sin,
      cos,
      cx - cos * cx + sin * cy,
      cy - sin * cx - cos * cy,
    ];

    const renderer = RendererRegistry.getRenderer(child);
    const childNodes = renderer ? await renderer(child, objectManager) : [];

    // Wrap the child's drawing between a push (apply the matrix) and a pop (restore).
    return [{ type: "transform-push", matrix }, ...childNodes, { type: "transform-pop" }];
  }
}

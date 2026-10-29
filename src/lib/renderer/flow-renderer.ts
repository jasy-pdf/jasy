import { FlowElement, FlowPieceElement } from "../elements/layout/flow-element.ts";
import { RegionElement } from "../elements/layout/region-element.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { IRNode } from "../ir/display-list.ts";
import { RendererRegistry, within, type RenderScope } from "../utils/renderer-registry.ts";

/** A Flow draws the page it made (laid out in place, in a box with a height). */
export class FlowRenderer {
  static async render(
    flow: FlowElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x, y, piece } = flow.getProps();
    return piece ? RendererRegistry.render(piece, objectManager, within(scope, { x, y })) : [];
  }
}

/** One page of a Flow: its template, whose Regions draw what they hold. */
export class FlowPieceRenderer {
  static async render(
    piece: FlowPieceElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x, y, child } = piece.getProps();
    return RendererRegistry.render(child, objectManager, within(scope, { x, y }));
  }
}

export class RegionRenderer {
  static async render(
    region: RegionElement,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const { x, y, child } = region.getProps();
    return child ? RendererRegistry.render(child, objectManager, within(scope, { x, y })) : [];
  }
}

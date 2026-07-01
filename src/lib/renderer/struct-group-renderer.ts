import { StructGroup } from "../elements/layout/struct-group.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { IRNode } from "../ir/display-list.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";

/**
 * Renders a StructGroup: opens its structure element, renders the child under it, closes it. With accessible
 * tagging off it is fully transparent - just the child's IR.
 */
export class StructGroupRenderer {
  static async render(group: StructGroup, objectManager: PDFObjectManager): Promise<IRNode[]> {
    const { role, child } = group.getProps();
    const renderChild = async (): Promise<IRNode[]> => {
      const renderer = RendererRegistry.getRenderer(child);
      return renderer ? await renderer(child, objectManager) : [];
    };
    if (!objectManager.struct.enabled) return renderChild();

    const key = objectManager.struct.openElement(group.structId, role);
    objectManager.struct.push(key);
    try {
      return await renderChild();
    } finally {
      objectManager.struct.pop(); // keep the parent stack balanced even if a child throws
    }
  }
}

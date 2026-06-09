import { pageFormats, PageSize } from "../constants/page-sizes";
import { PageElement } from "../elements/page-element";
import { PDFObjectManager } from "../utils/pdf-object-manager";
import { RendererRegistry } from "../utils/renderer-registry";
import { Orientation } from "./pdf-config";
import { IRNode } from "../ir/display-list";
import { PdfBackend } from "./pdf-backend";

export class PageRenderer {
  static async render(
    page: PageElement,
    objectManager: PDFObjectManager
  ): Promise<number> {
    const { children, config } = page.getProps();

    // Collect the whole page as a display list, then serialize it once. Serializing
    // is what registers the fonts/images used below, so it must run before the
    // resource section.
    const nodes: IRNode[] = [];
    for (const element of children) {
      const renderer = RendererRegistry.getRenderer(element);
      if (renderer) {
        nodes.push(...(await renderer(element, objectManager)));
      }
    }
    const pageContent = PdfBackend.serialize(nodes, objectManager);

    // Add the page content as a new object (content stream)
    const contentObjectNumber = objectManager.addObject(
      `<</Length ${pageContent.length}>>\nstream\n${pageContent}endstream`
    );

    // Get the parent object number dynamically (linked with the page object)
    const parentObjectNumber = objectManager.getParentObjectNumber(); // Get parent object number

    // Page object with MediaBox
    // - Get all fonts and add it to the page (reference)
    objectManager.registerFont("Helvetica");
    const fontReferences: string[] = [];
    objectManager.getAllFontsRaw().forEach((value, _key) => {
      const fontRef = `/F${value.fontIndex} ${value.resourceIndex} 0 R`;
      fontReferences.push(fontRef);
    });

    // - Get all images and add it to the page (reference)
    const imageReferences: string[] = [];
    objectManager.getAllImagesRaw().forEach((value) => {
      const imageRef = `/IM${value} ${value} 0 R`;
      imageReferences.push(imageRef);
    });
    const imageCode =
      imageReferences.length > 0
        ? "/ProcSet [/PDF /Text /ImageB /ImageC /ImageI] /XObject <<\n" +
          imageReferences.join("\n") +
          "\n>>\n"
        : "";

    // config is fully resolved by the layout pass; fall back to the document default
    // size rather than asserting, so the optional type stays honest.
    let [width, height] = pageFormats[config?.pageSize ?? PageSize.A4];
    if (config?.orientation === Orientation.landscape) {
      [width, height] = [height, width];
    }

    const pageObject = `<< /Type /Page /Parent ${parentObjectNumber} 0 R /Contents ${contentObjectNumber} 0 R /Resources <<\n/Font <<\n${fontReferences.join(
      "\n"
    )}\n>>\n${imageCode}>>\n/MediaBox [0 0 ${width} ${height}] >>`;

    // Add page as new object and return the page number
    return objectManager.addObject(pageObject);
  }
}

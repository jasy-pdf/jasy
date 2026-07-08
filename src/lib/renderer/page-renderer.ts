import { pageFormats, PageSize } from "../constants/page-sizes.ts";
import { PageElement } from "../elements/page-element.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import { Orientation } from "./pdf-config.ts";
import { IRNode } from "../ir/display-list.ts";
import { PdfBackend } from "./pdf-backend.ts";

export class PageRenderer {
  static async render(page: PageElement, objectManager: PDFObjectManager): Promise<number> {
    const { children, config, header, footer } = page.getProps();

    // Header (top band) and footer (bottom band) sit around the body and repeat on every
    // physical page; they are placed by `PageElement.calculateLayout` / the page driver.
    const renderables = [...(header ? [header] : []), ...children, ...(footer ? [footer] : [])];

    // Page geometry (also the MediaBox below). Needed up front because flipping the
    // display list to PDF coordinates uses the page height. config is fully resolved
    // by the layout pass; fall back to the document default rather than asserting.
    let [width, height] = config?.customSize ?? pageFormats[config?.pageSize ?? PageSize.A4];
    if (config?.orientation === Orientation.landscape) {
      [width, height] = [height, width];
    }

    // Collect the whole page as a display list (top-left coordinates), flip it to PDF
    // coordinates at this one seam, then serialize once. Serializing registers the
    // fonts/images used below, so it must run before the resource section.
    const nodes: IRNode[] = [];
    for (const element of renderables) {
      const renderer = RendererRegistry.getRenderer(element);
      if (renderer) {
        nodes.push(...(await renderer(element, objectManager)));
      }
    }
    // Accessible tagging: one struct context per page (allocates its StructParents index), threaded into
    // serialize so each drawable node is wrapped in marked content. Undefined = tagging off (byte-identical).
    const structCtx = objectManager.struct.enabled ? objectManager.struct.beginPage() : undefined;
    const flipped = PdfBackend.flipY(nodes, height);
    const pageContent = PdfBackend.serialize(flipped, objectManager, structCtx);

    // Add the page content as a new object (FlateDecode-compressed when enabled). The /Length is
    // computed inside, with an explicit EOL before `endstream` (PDF/A clause 6.1.7.1).
    const contentObjectNumber = objectManager.addContentStream(pageContent);

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

    // - Transparency (ExtGState) references, registered during serialize above
    const extGStateReferences: string[] = [];
    objectManager.getAllExtGStatesRaw().forEach((objectNumber, name) => {
      extGStateReferences.push(`/${name} ${objectNumber} 0 R`);
    });
    const extGStateCode =
      extGStateReferences.length > 0
        ? "/ExtGState <<\n" + extGStateReferences.join("\n") + "\n>>\n"
        : "";

    // - Gradient shadings (color-glyph fills), registered during serialize above
    const shadingReferences: string[] = [];
    objectManager.getAllShadingsRaw().forEach((objectNumber, name) => {
      shadingReferences.push(`/${name} ${objectNumber} 0 R`);
    });
    const shadingCode =
      shadingReferences.length > 0 ? "/Shading <<\n" + shadingReferences.join("\n") + "\n>>\n" : "";

    // Hyperlinks: a `Link` IR node drew nothing into the content stream - here its (already Y-flipped)
    // rect + href become a /Link annotation object. `/Border [0 0 0]` hides the default visible frame;
    // the URL is escaped like any PDF literal string. Refs are collected into the page's /Annots below.
    const num = (n: number) => Number(n.toFixed(2));
    const annotRefs: string[] = [];
    for (const node of flipped) {
      if (node.type !== "link") continue;
      const rect = `[${num(node.x)} ${num(node.y)} ${num(node.x + node.width)} ${num(node.y + node.height)}]`;
      const uri = PdfBackend.escapePdfString(node.href);
      const annot = objectManager.addObject(
        `<< /Type /Annot /Subtype /Link /Rect ${rect} /Border [0 0 0] /A << /S /URI /URI (${uri}) >> >>`,
      );
      annotRefs.push(`${annot} 0 R`);
    }
    const annotsCode = annotRefs.length > 0 ? ` /Annots [${annotRefs.join(" ")}]` : "";

    // Tagging only: /StructParents links this page's marked content to the ParentTree, /Tabs /S makes the
    // logical structure order the tab/reading order (a PDF/UA requirement).
    const structAttrs = structCtx ? ` /StructParents ${structCtx.structParents} /Tabs /S` : "";
    const pageObject = `<< /Type /Page /Parent ${parentObjectNumber} 0 R /Contents ${contentObjectNumber} 0 R /Resources <<\n/Font <<\n${fontReferences.join(
      "\n",
    )}\n>>\n${imageCode}${extGStateCode}${shadingCode}>>\n/MediaBox [0 0 ${width} ${height}]${structAttrs}${annotsCode} >>`;

    // Add page as new object; register its object number with the struct tree (for /Pg refs), then return it.
    const pageObjNum = objectManager.addObject(pageObject);
    if (structCtx) objectManager.struct.setPageObject(structCtx.structParents, pageObjNum);

    // Bookmarks: an `Outline` IR node drew nothing; record it now that the page's object number is known.
    // `node.y` is already Y-flipped to the page-space scroll target. PDFRenderer builds /Outlines at the end.
    for (const node of flipped) {
      if (node.type === "outline") {
        objectManager.outline.add({
          title: node.title,
          level: node.level,
          pageObjNum,
          top: node.y,
        });
      }
    }
    return pageObjNum;
  }
}

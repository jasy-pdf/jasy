import { PDFDocumentElement } from "../elements/pdf-document-element";
import { PDFDocumentRenderer } from "./pdf-document-renderer";
import { PDFObjectManager } from "../utils/pdf-object-manager";
import { RendererRegistry } from "../utils/renderer-registry";
import {
  ExpandedElement,
  ImageElement,
  LineElement,
  PaddingElement,
  TextElement,
} from "../elements";
import { TextRenderer } from "./text-renderer";
import { ContainerElement } from "../elements/container-element";
import { RectangleElement } from "../elements/rectangle-element";
import { ContainerRenderer } from "./container-renderer";
import { RectangleRenderer } from "./rectangle-renderer";
import { ExpandedRenderer } from "./expanded-renderer";
import { PaddingRenderer } from "./padding-renderer";
import { ImageRenderer } from "./image-renderer";
import { LineRenderer } from "./line-renderer";
import { LayoutContext } from "../elements/pdf-element";

export class PDFRenderer {
  static async render(
    document: PDFDocumentElement,
    objectManager: PDFObjectManager
  ): Promise<string> {
    // Register all Renderer
    RendererRegistry.register(TextElement, TextRenderer.render);
    RendererRegistry.register(ContainerElement, ContainerRenderer.render);
    RendererRegistry.register(RectangleElement, RectangleRenderer.render);
    RendererRegistry.register(ExpandedElement, ExpandedRenderer.render);
    RendererRegistry.register(PaddingElement, PaddingRenderer.render);
    RendererRegistry.register(ImageElement, ImageRenderer.render);
    RendererRegistry.register(LineElement, LineRenderer.render);

    let pdfContent = "";

    // Header
    pdfContent += "%PDF-1.4\n";

    // Layout pass: thread the context explicitly. The seed page config is the document
    // default; each PageElement overrides it for its own subtree.
    const ctx: LayoutContext = {
      metrics: objectManager,
      pageConfig: objectManager.getPDFConfig(),
    };
    document.calculateLayout(undefined, ctx);

    // Render pages and contents
    await PDFDocumentRenderer.render(document, objectManager);

    // Add catalog objects
    const catalogObject = `<< /Type /Catalog /Pages ${objectManager.getParentObjectNumber()} 0 R >>`;
    objectManager.addObject(catalogObject);

    // Add rendered objects
    pdfContent += objectManager.getRenderedObjects();

    // Add XRef table and trailer
    const startxref = pdfContent.length;
    pdfContent += objectManager.getXRefTable();
    pdfContent += objectManager.getTrailerAndXRef(startxref);

    return pdfContent;
  }
}

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
import { RowElement } from "../elements/row-element";
import { ContainerRenderer } from "./container-renderer";
import { RectangleRenderer } from "./rectangle-renderer";
import { RowRenderer } from "./row-renderer";
import { ExpandedRenderer } from "./expanded-renderer";
import { PaddingRenderer } from "./padding-renderer";
import { ImageRenderer } from "./image-renderer";
import { LineRenderer } from "./line-renderer";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element";
import { RepeatingHeaderRenderer } from "./repeating-header-renderer";
import { DeferredElement } from "../elements/layout/deferred-element";
import { DeferredRenderer } from "./deferred-renderer";
import { BoxConstraints } from "../layout/box-constraints";
import { LayoutContext } from "../elements/pdf-element";

export class PDFRenderer {
  static async render(
    document: PDFDocumentElement,
    objectManager: PDFObjectManager,
  ): Promise<string> {
    // Register all Renderer
    RendererRegistry.register(TextElement, TextRenderer.render);
    RendererRegistry.register(ContainerElement, ContainerRenderer.render);
    RendererRegistry.register(RowElement, RowRenderer.render);
    RendererRegistry.register(RectangleElement, RectangleRenderer.render);
    RendererRegistry.register(ExpandedElement, ExpandedRenderer.render);
    RendererRegistry.register(PaddingElement, PaddingRenderer.render);
    RendererRegistry.register(ImageElement, ImageRenderer.render);
    RendererRegistry.register(LineElement, LineRenderer.render);
    RendererRegistry.register(RepeatingHeaderElement, RepeatingHeaderRenderer.render);
    RendererRegistry.register(DeferredElement, DeferredRenderer.render);

    let pdfContent = "";

    // Header. The version is always "1.X" (default 1.4; PDF/A-3 uses 1.7) so the 9-byte header
    // length - which the xref offsets are computed against - is unchanged.
    pdfContent += `%PDF-${objectManager.getPdfVersion()}\n`;

    // Layout pass: thread the context explicitly. The seed page config is the document
    // default; each PageElement overrides it for its own subtree.
    const ctx: LayoutContext = {
      metrics: objectManager,
      pageConfig: objectManager.getPDFConfig(),
    };
    document.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx);

    // Render pages and contents (the driver paginates overflowing pages).
    await PDFDocumentRenderer.render(document, objectManager, ctx);

    // Add the catalog. XMP metadata (/Metadata) and embedded files (/AF + /Names/EmbeddedFiles)
    // are added only when present; with neither, the catalog is byte-identical to before.
    const catalogParts = [`/Type /Catalog /Pages ${objectManager.getParentObjectNumber()} 0 R`];

    const xmp = objectManager.getXmpMetadata();
    if (xmp) {
      const metadataObject = objectManager.addObject(
        `<< /Type /Metadata /Subtype /XML /Length ${xmp.length} >>\nstream\n${xmp}\nendstream`,
      );
      catalogParts.push(`/Metadata ${metadataObject} 0 R`);
    }

    const outputIntent = objectManager.getOutputIntent();
    if (outputIntent) {
      catalogParts.push(`/OutputIntents [${outputIntent} 0 R]`);
    }

    const attachments = objectManager.getAttachments();
    if (attachments.length > 0) {
      const names = attachments.map((a) => `(${a.name}) ${a.filespec} 0 R`).join(" ");
      const af = attachments.map((a) => `${a.filespec} 0 R`).join(" ");
      catalogParts.push(`/AF [${af}]`, `/Names << /EmbeddedFiles << /Names [${names}] >> >>`);
    }

    const catalogObject = `<< ${catalogParts.join(" ")} >>`;
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

import { PDFDocumentElement } from "../elements/pdf-document-element.ts";
import { PDFDocumentRenderer } from "./pdf-document-renderer.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { RendererRegistry } from "../utils/renderer-registry.ts";
import {
  DefaultTextStyleElement,
  ExpandedElement,
  ImageElement,
  LineElement,
  PaddingElement,
  TextElement,
} from "../elements/index.ts";
import { TextRenderer } from "./text-renderer.ts";
import { ContainerElement } from "../elements/container-element.ts";
import { RectangleElement } from "../elements/rectangle-element.ts";
import { RowElement } from "../elements/row-element.ts";
import { ContainerRenderer } from "./container-renderer.ts";
import { RectangleRenderer } from "./rectangle-renderer.ts";
import { RowRenderer } from "./row-renderer.ts";
import { ExpandedRenderer } from "./expanded-renderer.ts";
import { PaddingRenderer } from "./padding-renderer.ts";
import { DefaultTextStyleRenderer } from "./default-text-style-renderer.ts";
import { ImageRenderer } from "./image-renderer.ts";
import { LineRenderer } from "./line-renderer.ts";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element.ts";
import { RepeatingHeaderRenderer } from "./repeating-header-renderer.ts";
import { DeferredElement } from "../elements/layout/deferred-element.ts";
import { DeferredRenderer } from "./deferred-renderer.ts";
import { PositionedElement } from "../elements/layout/positioned-element.ts";
import { PositionedRenderer } from "./positioned-renderer.ts";
import { StructGroup } from "../elements/layout/struct-group.ts";
import { StructGroupRenderer } from "./struct-group-renderer.ts";
import { LinkElement } from "../elements/layout/link-element.ts";
import { LinkRenderer } from "./link-renderer.ts";
import { BookmarkElement } from "../elements/layout/bookmark-element.ts";
import { BookmarkRenderer } from "./bookmark-renderer.ts";
import { AnchorElement } from "../elements/layout/anchor-element.ts";
import { AnchorRenderer } from "./anchor-renderer.ts";
import { PageBuilderElement } from "../elements/layout/page-builder-element.ts";
import { PageBuilderRenderer } from "./page-builder-renderer.ts";
import { RotatedElement } from "../elements/layout/rotated-element.ts";
import { RotatedBoxElement } from "../elements/layout/rotated-box-element.ts";
import { RotatedRenderer } from "./rotated-renderer.ts";
import { PdfBackend } from "./pdf-backend.ts";
import { BoxConstraints } from "../layout/box-constraints.ts";
import { collectImageElements } from "../layout/collect-images.ts";
import { LayoutContext } from "../elements/pdf-element.ts";
import { DEFAULT_TEXT_STYLE, mergeTextStyle } from "../text/text-style.ts";

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
    RendererRegistry.register(DefaultTextStyleElement, DefaultTextStyleRenderer.render);
    RendererRegistry.register(ImageElement, ImageRenderer.render);
    RendererRegistry.register(LineElement, LineRenderer.render);
    RendererRegistry.register(RepeatingHeaderElement, RepeatingHeaderRenderer.render);
    RendererRegistry.register(DeferredElement, DeferredRenderer.render);
    RendererRegistry.register(PositionedElement, PositionedRenderer.render);
    RendererRegistry.register(StructGroup, StructGroupRenderer.render);
    RendererRegistry.register(LinkElement, LinkRenderer.render);
    RendererRegistry.register(BookmarkElement, BookmarkRenderer.render);
    RendererRegistry.register(AnchorElement, AnchorRenderer.render);
    RendererRegistry.register(PageBuilderElement, PageBuilderRenderer.render);
    RendererRegistry.register(RotatedElement, RotatedRenderer.render);
    RendererRegistry.register(RotatedBoxElement, RotatedRenderer.render);

    let pdfContent = "";

    // Header: version line + the PDF/A binary marker (the object manager owns it so its length
    // matches the xref offset calculation).
    pdfContent += objectManager.getHeader();

    // Layout pass: thread the context explicitly. The seed page config is the document
    // default; each PageElement overrides it for its own subtree.
    const ctx: LayoutContext = {
      metrics: objectManager,
      pageConfig: objectManager.getPDFConfig(),
      textStyle: mergeTextStyle(DEFAULT_TEXT_STYLE, document.getDefaultTextStyle()),
      onOverflow: objectManager.getOverflowPolicy(),
    };
    // Pre-layout: resolve every image's intrinsic pixel size (async), so the synchronous layout can
    // give a width-only image a proportional height. init() is idempotent, so the renderer reuses it.
    const images = collectImageElements(document);
    if (images.length > 0) await Promise.all(images.map((img) => img.resolveIntrinsicSize()));

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

    // The catalog has exactly one /Names dict; embedded files and named destinations are two entries in
    // it, so collect both and emit the /Names once (below).
    const namesParts: string[] = [];

    const attachments = objectManager.getAttachments();
    if (attachments.length > 0) {
      // The name-tree key is a PDF literal string, so it needs the same escaping the /Filespec's /F and
      // /UF get in attachFile(). Unescaped, a ")" or "\" in a file name closes the string early and the
      // rest of it leaks out as raw operators.
      const names = attachments
        .map((a) => `(${PdfBackend.escapePdfString(a.name)}) ${a.filespec} 0 R`)
        .join(" ");
      const af = attachments.map((a) => `${a.filespec} 0 R`).join(" ");
      catalogParts.push(`/AF [${af}]`);
      namesParts.push(`/EmbeddedFiles << /Names [${names}] >>`);
    }

    // Accessible tagging: finalize the structure tree (emits StructTreeRoot + StructElems + ParentTree) and
    // fold /MarkInfo + /StructTreeRoot + /Lang into the catalog. Returns "" (no-op) when tagging is off.
    const structCatalog = objectManager.struct.finalize(objectManager);
    if (structCatalog) {
      catalogParts.push(structCatalog);
      // PDF/UA requires the viewer to show the document title (not the file name).
      catalogParts.push("/ViewerPreferences << /DisplayDocTitle true >>");
    }

    // Document outline (bookmarks): emit the /Outlines tree collected during page rendering. Returns
    // "" (no-op) when no Bookmark was placed, so a plain document's catalog is unchanged.
    const outlineCatalog = objectManager.outline.finalize(objectManager);
    if (outlineCatalog) catalogParts.push(outlineCatalog);

    // Named destinations (internal-link targets): a /Dests entry in the shared /Names dict.
    const destsNames = objectManager.dests.finalize();
    if (destsNames) namesParts.push(destsNames);

    // Emit the single /Names dict if either embedded files or destinations contributed to it.
    if (namesParts.length > 0) catalogParts.push(`/Names << ${namesParts.join(" ")} >>`);

    const catalogObject = `<< ${catalogParts.join(" ")} >>`;
    objectManager.addObject(catalogObject);

    // Now that the render pass has revealed which glyphs each embedded font uses, fill the reserved
    // font objects with the subset font program (must happen before the objects are serialized).
    objectManager.finalizeCustomFonts();

    // Encrypt every registered stream + add the /Encrypt object (no-op unless a security handler was set).
    await objectManager.finalizeEncryption();

    // Add rendered objects
    pdfContent += objectManager.getRenderedObjects();

    // Add XRef table and trailer
    const startxref = pdfContent.length;
    pdfContent += objectManager.getXRefTable();
    pdfContent += objectManager.getTrailerAndXRef(startxref);

    return pdfContent;
  }
}

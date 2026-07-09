import { PDFDocumentElement } from "../elements/pdf-document-element.ts";
import {
  layoutPageBands,
  PageElement,
  PDFPageConfig,
  resolvePageSize,
} from "../elements/page-element.ts";
import { LayoutContext, PDFElement } from "../elements/pdf-element.ts";
import { BoxConstraints } from "../layout/box-constraints.ts";
import { isFragmentable } from "../layout/fragmentation.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PageRenderer } from "./page-renderer.ts";

/**
 * One physical PDF page, decided during pagination and rendered afterwards. `whole` = the logical page
 * fits as-is; `fragment` = one slice of an overflowing page, placed on a fresh page of the same geometry.
 * Both are laid out again in pass B, which is what lets a `PageBuilder` see its final page number.
 */
type PhysicalPage =
  | { kind: "whole"; page: PageElement }
  | {
      kind: "fragment";
      config: PDFPageConfig | undefined;
      content: PDFElement;
      header: PDFElement | undefined;
      footer: PDFElement | undefined;
    };

export class PDFDocumentRenderer {
  static async render(
    document: PDFDocumentElement,
    objectManager: PDFObjectManager,
    ctx: LayoutContext,
  ): Promise<number> {
    // Add the pages object first... we need its object number (resources). The count is
    // a placeholder; it is replaced below with the real (post-pagination) page count.
    const pagesObject = `<< /Type /Pages /Kids [] /Count ${document.getProps().children.length} >>`;
    const pagesObjectNumber = objectManager.addObject(pagesObject);

    // Now set the given object number all its childs
    objectManager.setParentObjectNumber(pagesObjectNumber);

    // Pass A - paginate the whole document WITHOUT drawing anything. Fragmentation is synchronous and
    // pure (`{ fitted, remainder }`), so the full list of physical pages can be settled up front. Only
    // then is the total page count known, which is what page numbers in a header/footer need.
    const physicalPages: PhysicalPage[] = [];
    for (const page of document.getProps().children) {
      physicalPages.push(...PDFDocumentRenderer.paginateLogicalPage(page, ctx));
    }

    // Pass B - draw them, in order, so the emitted page objects keep their previous numbering. Each page
    // is laid out again with its own PageInfo, which is how a `PageBuilder` anywhere in the tree (header,
    // footer or body) learns its final page number and the now-known document total.
    const pageNumbers: number[] = [];
    for (const [index, physical] of physicalPages.entries()) {
      const pageInfo = {
        pageNumber: index + 1,
        pageCount: physicalPages.length,
        pageSize: resolvePageSize(PDFDocumentRenderer.configOf(physical, ctx)),
      };
      pageNumbers.push(
        await PDFDocumentRenderer.renderPhysicalPage(physical, objectManager, {
          ...ctx,
          pageInfo,
        }),
      );
    }

    // We must update the pages object with the real physical page numbers and count.
    const updatedPagesObject = `<< /Type /Pages /Kids [${pageNumbers
      .map((num) => `${num} 0 R`)
      .join(" ")}] /Count ${pageNumbers.length} >>`;

    // Now we must replace it in the object manager
    objectManager.replaceObject(pagesObjectNumber, updatedPagesObject);

    return pagesObjectNumber;
  }

  /** The page geometry a physical page will use. Pass 1 already merged the document defaults into every
   *  `PageElement.config`; a page that never carried its own config falls back to the document's. */
  private static configOf(physical: PhysicalPage, ctx: LayoutContext): PDFPageConfig {
    const config = physical.kind === "whole" ? physical.page.getProps().config : physical.config;
    return config ?? ctx.pageConfig;
  }

  /**
   * Splits one logical page into the physical pages it will occupy, without rendering.
   *
   * Only the common shape auto-paginates - a page whose single child is a fragmentation context
   * (a Container). Anything else stays a single page on the unchanged path, so non-overflowing
   * documents keep producing byte-identical output.
   */
  private static paginateLogicalPage(page: PageElement, ctx: LayoutContext): PhysicalPage[] {
    const { children, config, header, footer } = page.getProps();

    if (children.length !== 1 || !isFragmentable(children[0])) {
      return [{ kind: "whole", page }];
    }

    // Header/footer repeat on every physical page, so the body only ever flows into the
    // band between them. Resolve that band once (config is already merged by pass 1).
    const pageCtx: LayoutContext = {
      metrics: ctx.metrics,
      pageConfig: config!,
      textStyle: ctx.textStyle,
      onOverflow: ctx.onOverflow,
    };
    const { bodyWidth: width, bodyHeight: height } = layoutPageBands(
      config!,
      header,
      footer,
      pageCtx,
    );

    const pages: PhysicalPage[] = [];
    let region: PDFElement | null = children[0];
    let isFirstRegion = true;

    while (region) {
      if (!isFragmentable(region)) {
        // A non-fragmentable remainder is placed whole on its own page.
        pages.push({ kind: "fragment", config, content: region, header, footer });
        break;
      }

      // pageCtx, not the document ctx: a descendant that reads `pageConfig` while being measured (a
      // `PageBuilder` sizing its provisional build) must see THIS page's geometry, not the document default.
      const { fitted, remainder } = region.fragment(height, width, pageCtx);

      // Everything fits on one page: keep the ORIGINAL page so output is unchanged. Measuring inside
      // fragment() left its children at the measuring origin; pass B lays the page out again, which
      // restores their real positions (layout is deterministic).
      if (isFirstRegion && remainder === null) {
        pages.push({ kind: "whole", page });
        break;
      }

      if (fitted) {
        pages.push({ kind: "fragment", config, content: fitted, header, footer });
      }
      region = remainder;
      isFirstRegion = false;
    }

    return pages;
  }

  /**
   * Lays out one physical page and renders it. A fragment gets a fresh `PageElement` of the same
   * geometry; the header/footer are attached to every physical page so they repeat, and `PageElement`
   * re-places them and the body in the band between.
   */
  private static async renderPhysicalPage(
    physical: PhysicalPage,
    objectManager: PDFObjectManager,
    ctx: LayoutContext,
  ): Promise<number> {
    if (physical.kind === "whole") {
      physical.page.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx);
      return PageRenderer.render(physical.page, objectManager);
    }

    const page = new PageElement({
      config: physical.config,
      header: physical.header,
      footer: physical.footer,
      children: [physical.content],
    });
    page.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx);
    return PageRenderer.render(page, objectManager);
  }
}

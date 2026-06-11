import { PDFDocumentElement } from "../elements/pdf-document-element";
import {
  PageElement,
  PDFPageConfig,
  resolvePageContentBox,
} from "../elements/page-element";
import { LayoutContext, PDFElement } from "../elements/pdf-element";
import { BoxConstraints } from "../layout/box-constraints";
import { isFragmentable } from "../layout/fragmentation";
import { PDFObjectManager } from "../utils/pdf-object-manager";
import { PageRenderer } from "./page-renderer";

export class PDFDocumentRenderer {
  static async render(
    document: PDFDocumentElement,
    objectManager: PDFObjectManager,
    ctx: LayoutContext
  ): Promise<number> {
    const pageNumbers: number[] = [];

    // Add the pages object first... we need its object number (resources). The count is
    // a placeholder; it is replaced below with the real (post-pagination) page count.
    const pagesObject = `<< /Type /Pages /Kids [] /Count ${
      document.getProps().children.length
    } >>`;
    const pagesObjectNumber = objectManager.addObject(pagesObject);

    // Now set the given object number all its childs
    objectManager.setParentObjectNumber(pagesObjectNumber);

    // The page driver: each logical PageElement may produce SEVERAL physical PDF pages
    // when its content overflows (Slice 0: whole children reflow to the next page).
    for (let page of document.getProps().children) {
      const numbers = await PDFDocumentRenderer.renderLogicalPage(
        page,
        objectManager,
        ctx
      );
      pageNumbers.push(...numbers);
    }

    // We must update the pages object with the real physical page numbers and count.
    const updatedPagesObject = `<< /Type /Pages /Kids [${pageNumbers
      .map((num) => `${num} 0 R`)
      .join(" ")}] /Count ${pageNumbers.length} >>`;

    // Now we must replace it in the object manager
    objectManager.replaceObject(pagesObjectNumber, updatedPagesObject);

    return pagesObjectNumber;
  }

  /**
   * Renders one logical page, paginating it into one or more physical pages.
   *
   * Slice 0 only auto-paginates the common shape - a page whose single child is a
   * fragmentation context (a Container). Anything else renders as a single page on the
   * unchanged path, so non-overflowing documents stay byte-identical to pre-Slice-0.
   */
  private static async renderLogicalPage(
    page: PageElement,
    objectManager: PDFObjectManager,
    ctx: LayoutContext
  ): Promise<number[]> {
    const { children, config } = page.getProps();

    if (children.length !== 1 || !isFragmentable(children[0])) {
      return [await PageRenderer.render(page, objectManager)];
    }

    const { width, height } = resolvePageContentBox(config!);
    const numbers: number[] = [];
    let region: PDFElement | null = children[0];
    let isFirstRegion = true;

    while (region) {
      if (!isFragmentable(region)) {
        // A non-fragmentable remainder is placed whole on its own page.
        numbers.push(
          await PDFDocumentRenderer.renderPhysicalPage(
            config,
            region,
            objectManager,
            ctx
          )
        );
        break;
      }

      const { fitted, remainder } = region.fragment(height, width, ctx);

      // Everything fits on one page: render the ORIGINAL page so output is unchanged.
      // Measuring inside fragment() laid the children out at the origin to size them, so
      // re-run the page layout first to restore their real positions (deterministic).
      if (isFirstRegion && remainder === null) {
        page.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx);
        numbers.push(await PageRenderer.render(page, objectManager));
        break;
      }

      if (fitted) {
        numbers.push(
          await PDFDocumentRenderer.renderPhysicalPage(
            config,
            fitted,
            objectManager,
            ctx
          )
        );
      }
      region = remainder;
      isFirstRegion = false;
    }

    return numbers;
  }

  /** Lays out one fragment on a fresh page of the same geometry and renders it. */
  private static async renderPhysicalPage(
    config: PDFPageConfig | undefined,
    content: PDFElement,
    objectManager: PDFObjectManager,
    ctx: LayoutContext
  ): Promise<number> {
    const physicalPage = new PageElement({ config, children: [content] });
    physicalPage.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx);
    return PageRenderer.render(physicalPage, objectManager);
  }
}

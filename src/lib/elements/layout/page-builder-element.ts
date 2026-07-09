import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, PageInfo, PDFElement } from "../pdf-element.ts";
import { resolvePageSize } from "../page-element.ts";

/**
 * Builds its subtree from the page it lands on, so a header, a footer or plain body content can show
 * `pageNumber` / `pageCount`. The closure runs on EVERY layout, because the numbers differ between the
 * two driver passes: pagination has to size the element before the page total exists, so it builds
 * against a provisional "1 of 1"; the render pass then rebuilds it with the real `PageInfo`.
 *
 * Two consequences, and neither is magic - both come from the same chicken-and-egg: the content decides
 * the page count that the content displays.
 *
 * 1. In the flowing BODY the box is reserved by the provisional build, so a much wider final string
 *    (`"9 of 10"` vs `"1 of 1"`) can paint slightly past it. Keep dynamic body content roughly constant
 *    in width.
 * 2. A header/footer is re-laid out per page, so its real height is honoured - but the BODY band was
 *    already sized against the provisional build. A later page whose header is SHORTER simply gains
 *    room (harmless). A later page whose header is TALLER shrinks the band its body was measured for,
 *    and that body can overflow. So: a conditional header may shrink on later pages, never grow.
 */
export class PageBuilderElement extends PDFElement {
  private composed?: PDFElement;
  private readonly build: (info: PageInfo) => PDFElement;

  constructor({ build }: { build: (info: PageInfo) => PDFElement }) {
    super();
    this.build = build;
  }

  /** The real page info during the render pass; a provisional "1 of 1" while paginating. */
  private infoFrom(ctx: LayoutContext): PageInfo {
    return (
      ctx.pageInfo ?? {
        pageNumber: 1,
        pageCount: 1,
        pageSize: resolvePageSize(ctx.pageConfig),
      }
    );
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.composed = this.build(this.infoFrom(ctx));
    return this.composed.calculateLayout(constraints, offset, ctx);
  }

  // Named `composed` (not `child`) like DeferredElement: the pre-layout image walk keys on `child`, and
  // this subtree does not exist yet when it runs. So an Image inside a PageBuilder skips aspect-ratio
  // pre-resolution - give it both width and height, exactly as inside a Deferred/Table subtree.
  override getProps() {
    return { composed: this.composed };
  }
}

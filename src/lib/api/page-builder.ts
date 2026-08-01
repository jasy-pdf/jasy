import { PageBuilderElement } from "../elements/layout/page-builder-element.ts";
import { PageInfo, PDFElement } from "../elements/pdf-element.ts";
import { Text, TextOptions } from "./text.ts";

export type { PageInfo };

/**
 * Builds content from the page it ends up on - this is how you show `pageNumber` / `pageCount`. Place it
 * anywhere: in a `Page`'s `header`/`footer`, in the body, in a table cell, several times on one page.
 * Because you write the closure, formatting and conditions are yours:
 *
 * ```ts
 * PageBuilder(({ pageNumber, pageCount }) => Text(`Seite ${pageNumber} von ${pageCount}`))
 * PageBuilder(({ pageNumber }) => (pageNumber === 1 ? Logo() : Text("Fortsetzung")))
 * PageBuilder(({ pageNumber, pageCount }) => Text(`${pageNumber - 1} / ${pageCount - 1}`)) // cover page
 * ```
 *
 * `pageNumber` is 1-based and counts PHYSICAL pages (an overflowing `Page` contributes several);
 * `pageCount` is the document total; `pageSize` is the media box in points.
 *
 * `subPageNumber` / `subPageTotalPages` are the same counts WITHIN one logical `Page` element - what you
 * want when a document is several sections and the footer should say "Attachment, page 1 of 4" beside
 * "sheet 4 of 7". With a single `Page` they are identical to the document counts.
 *
 * The numbers themselves are always exact. Two sizing caveats, both from the same chicken-and-egg (the
 * content decides the count that the content displays): in the flowing BODY the box is reserved before the
 * total is known, so a much wider final string can paint slightly past it; and a conditional header may
 * SHRINK on later pages but must not GROW, because the body band was measured against the first build.
 */
export function PageBuilder(build: (info: PageInfo) => PDFElement): PageBuilderElement {
  return new PageBuilderElement({ build });
}

/** `Text` options plus an `offset` added to the number (e.g. `-1` to not count a cover page). */
export interface PageNumberOptions extends TextOptions {
  offset?: number;
}

/** The current page number as text. Sugar for `PageBuilder` - same thing, one word. */
export function PageNumber({ offset = 0, ...style }: PageNumberOptions = {}): PageBuilderElement {
  return PageBuilder(({ pageNumber }) => Text(String(pageNumber + offset), style));
}

/** The document's total page count as text. Sugar for `PageBuilder`. */
export function PageCount({ offset = 0, ...style }: PageNumberOptions = {}): PageBuilderElement {
  return PageBuilder(({ pageCount }) => Text(String(pageCount + offset), style));
}

/** The page number WITHIN its logical `Page` (a section), as text. Sugar for `PageBuilder`. */
export function SubPageNumber({
  offset = 0,
  ...style
}: PageNumberOptions = {}): PageBuilderElement {
  return PageBuilder(({ subPageNumber }) => Text(String(subPageNumber + offset), style));
}

/** How many pages the surrounding logical `Page` produced, as text. Sugar for `PageBuilder`. */
export function SubPageCount({ offset = 0, ...style }: PageNumberOptions = {}): PageBuilderElement {
  return PageBuilder(({ subPageTotalPages }) => Text(String(subPageTotalPages + offset), style));
}

import { PDFElement, hasChildrenProp, hasChildProp } from "../elements/pdf-element.ts";
import { ImageElement } from "../elements/image-element.ts";
import { SvgElement } from "../elements/svg-element.ts";

/**
 * Walks the element tree (via `getProps`, the same shallow-reflection style as the validator) and
 * returns every image - a bitmap, or an SVG (which needs this only when it comes from a URL). A
 * pre-layout pass uses this to resolve each one's intrinsic size asynchronously: layout is synchronous
 * and cannot await a decoder or a fetch, yet it needs the aspect ratio to give a width-only image its
 * proportional height. Cheap - images are few and this runs once.
 */
export function collectImageElements(root: PDFElement): (ImageElement | SvgElement)[] {
  const out: (ImageElement | SvgElement)[] = [];
  const visit = (el: PDFElement): void => {
    if (el instanceof ImageElement || el instanceof SvgElement) out.push(el);
    const props = el.getProps() as object;
    if (hasChildrenProp(props)) for (const c of props.children) visit(c);
    else if (hasChildProp(props)) visit(props.child);
    // Wrappers that hold a subtree outside `children`/`child`: a Page's header/footer and a
    // RepeatingHeaderElement's `body` (a Table with a header wraps its rows there). A
    // DeferredElement's `composed` is null until layout runs, so it cannot be reached from this
    // pre-layout pass; an image inside a deferred subtree just skips aspect pre-resolution.
    const w = props as { header?: unknown; footer?: unknown; body?: unknown };
    if (w.header instanceof PDFElement) visit(w.header);
    if (w.footer instanceof PDFElement) visit(w.footer);
    if (w.body instanceof PDFElement) visit(w.body);
  };
  visit(root);
  return out;
}

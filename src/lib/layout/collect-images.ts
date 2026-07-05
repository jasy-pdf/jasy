import { PDFElement, hasChildrenProp, hasChildProp } from "../elements/pdf-element.ts";
import { ImageElement } from "../elements/image-element.ts";

/**
 * Walks the element tree (via `getProps`, the same shallow-reflection style as the validator) and
 * returns every `ImageElement`. A pre-layout pass uses this to resolve each image's intrinsic pixel
 * size asynchronously: layout is synchronous and cannot await jimp, yet it needs the aspect ratio to
 * give a width-only image its proportional height. Cheap - images are few and this runs once.
 */
export function collectImageElements(root: PDFElement): ImageElement[] {
  const out: ImageElement[] = [];
  const visit = (el: PDFElement): void => {
    if (el instanceof ImageElement) out.push(el);
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

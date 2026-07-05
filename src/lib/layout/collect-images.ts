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
    // A page carries its header / footer outside `children`.
    const pg = props as { header?: unknown; footer?: unknown };
    if (pg.header instanceof PDFElement) visit(pg.header);
    if (pg.footer instanceof PDFElement) visit(pg.footer);
  };
  visit(root);
  return out;
}

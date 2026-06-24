import { PDFElement } from "../elements/pdf-element.ts";

/**
 * Lets a container factory be called either `F(children)` or `F(opts, children)` - the
 * same ergonomic shape across Document/Page/Column/Row/Box. When the first argument is the
 * child array, options default to empty.
 */
export function splitArgs<O>(
  a: O | PDFElement[],
  b?: PDFElement[],
): { opts: O; children: PDFElement[] } {
  if (Array.isArray(a)) return { opts: {} as O, children: a };
  return { opts: a, children: b ?? [] };
}

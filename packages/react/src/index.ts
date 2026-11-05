// @jasy/react - author PDFs as React components. Isomorphic: renders in the browser and in Node.
// `renderToPdf` goes all the way to PDF bytes; `toDocumentDescriptor` stops at the engine's descriptor.
import type { ReactNode } from "react";
import {
  buildDocument,
  renderPdf,
  renderToBytes,
  type Descriptor,
  type PDFDocumentElement,
  type RenderOptions,
} from "@jasy/pdf";
import { mountDocument } from "./renderer.js";

export * from "./components.js";

/** Mounted until the PDF is done: a `Flow` renders its page while the engine lays the pages out. */
async function rendered<T>(
  element: ReactNode,
  render: (doc: PDFDocumentElement) => Promise<T>,
): Promise<T> {
  const { descriptor, unmount } = mountDocument(element);
  try {
    return await render(buildDocument(descriptor));
  } finally {
    unmount();
  }
}

/** Render an element whose root is a `<Document>` to PDF bytes - browser or Node. */
export function renderToPdf(
  element: ReactNode,
  options?: RenderOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  return rendered(element, (doc) => renderToBytes(doc, options));
}

/** Render an element to the raw PDF string - browser or Node. */
export function renderToPdfString(element: ReactNode, options?: RenderOptions): Promise<string> {
  return rendered(element, (doc) => renderPdf(doc, options));
}

/**
 * The engine descriptor for an element's `<Document>`: a plain, serializable object, e.g. to post to a
 * server. A `Flow` and a `PageBuilder` render during the PDF render, so a document with one goes through
 * `renderToPdf` instead.
 */
export function toDocumentDescriptor(element: ReactNode): Descriptor {
  const { descriptor, unmount } = mountDocument(element);
  unmount();
  return descriptor;
}

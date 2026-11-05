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
 * The engine descriptor for an element's `<Document>`, a plain object. As JSON it loses what JSON cannot
 * hold: bytes (encode fonts and images yourself) and functions - a `Canvas`'s paint, and a `Flow` or
 * `PageBuilder`, which render during the PDF render. Those documents go through `renderToPdf`.
 */
export function toDocumentDescriptor(element: ReactNode): Descriptor {
  const { descriptor, unmount } = mountDocument(element);
  unmount();
  return descriptor;
}

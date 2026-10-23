// @jasy/vue - author PDFs as Vue components. Isomorphic: this entry works in the BROWSER and in Node, now
// that the @jasy/pdf engine is browser-safe. `toDocumentDescriptor` turns a component into a descriptor;
// `renderToPdf` goes all the way to PDF bytes - in the browser too, no server needed.
import type { Component } from "vue";
import {
  buildDocument,
  renderToBytes,
  renderPdf,
  type PDFDocumentElement,
  type RenderOptions,
} from "@jasy/pdf";
import { mountDocument } from "./renderer.js";

export * from "./components.js";
export { toDocumentDescriptor } from "./renderer.js";

/** Mounted until the PDF is done: a `<Flow>` renders its #page while the engine lays the pages out. */
async function rendered<T>(
  root: Component,
  props: Record<string, any> | undefined,
  render: (doc: PDFDocumentElement) => Promise<T>,
): Promise<T> {
  const { descriptor, unmount } = mountDocument(root, props);
  try {
    return await render(buildDocument(descriptor));
  } finally {
    unmount();
  }
}

/** Render a Vue component (whose root is `<Document>`) to PDF bytes - browser or Node. */
export function renderToPdf(
  root: Component,
  props?: Record<string, any>,
  options?: RenderOptions,
): Promise<Uint8Array<ArrayBuffer>> {
  return rendered(root, props, (doc) => renderToBytes(doc, options));
}

/** Render a Vue component to the raw PDF string - browser or Node. */
export function renderToPdfString(
  root: Component,
  props?: Record<string, any>,
  options?: RenderOptions,
): Promise<string> {
  return rendered(root, props, (doc) => renderPdf(doc, options));
}

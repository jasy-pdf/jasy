// @jasy/vue - author PDFs as Vue components. Isomorphic: this entry works in the BROWSER and in Node, now
// that the @jasy/pdf engine is browser-safe. `toDocumentDescriptor` turns a component into a descriptor;
// `renderToPdf` goes all the way to PDF bytes - in the browser too, no server needed.
import type { Component } from "vue";
import { buildDocument, renderToBytes, renderPdf, type RenderOptions } from "@jasy/pdf";
import { toDocumentDescriptor } from "./renderer.js";

export * from "./components.js";
export { toDocumentDescriptor } from "./renderer.js";

/** Render a Vue component (whose root is `<Document>`) to PDF bytes - browser or Node. */
export function renderToPdf(
  root: Component,
  props?: Record<string, any>,
  options?: RenderOptions,
): Promise<Uint8Array> {
  return renderToBytes(buildDocument(toDocumentDescriptor(root, props)), options);
}

/** Render a Vue component to the raw PDF string - browser or Node. */
export function renderToPdfString(
  root: Component,
  props?: Record<string, any>,
  options?: RenderOptions,
): Promise<string> {
  return renderPdf(buildDocument(toDocumentDescriptor(root, props)), options);
}

// Node-only entry (@jasy/vue/node): render a Vue component all the way to a PDF. Pulls in the @jasy/pdf
// engine (font metrics via fs), so it must NOT be imported from browser code - use `toDocumentDescriptor`
// there and post the descriptor to a Node renderer instead.
import type { Component } from "vue";
import { buildDocument, renderToBytes, renderPdf, type RenderOptions } from "@jasy/pdf";
import { toDocumentDescriptor } from "./renderer.js";

/** Render a Vue component (whose root is `<Document>`) to PDF bytes. */
export function renderToPdf(
  root: Component,
  props?: Record<string, any>,
  options?: RenderOptions,
): Promise<Uint8Array> {
  return renderToBytes(buildDocument(toDocumentDescriptor(root, props)), options);
}

/** Render a Vue component to the raw PDF string. */
export function renderToPdfString(
  root: Component,
  props?: Record<string, any>,
  options?: RenderOptions,
): Promise<string> {
  return renderPdf(buildDocument(toDocumentDescriptor(root, props)), options);
}

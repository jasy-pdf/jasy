// @jasy/vue - author PDFs as Vue components. A thin custom renderer maps a Vue component tree onto the
// @jasy/pdf descriptor seam; the host components below are the tags you write.
export * from "./components.js";
export { renderToPdf, renderToPdfString, toDocumentDescriptor } from "./renderer.js";

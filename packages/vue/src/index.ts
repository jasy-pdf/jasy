// @jasy/vue - author PDFs as Vue components. This entry is browser-safe: the host components plus
// `toDocumentDescriptor` (Vue component -> serialisable descriptor). The Node-only `renderToPdf`
// (which pulls in the @jasy/pdf engine) lives in the separate "@jasy/vue/node" entry.
export * from "./components.js";
export { toDocumentDescriptor } from "./renderer.js";

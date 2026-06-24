// Back-compat shim: the render now lives in the main, isomorphic entry (the @jasy/pdf engine is browser-safe).
// Re-exported here so existing `@jasy/vue/node` imports keep working.
export { renderToPdf, renderToPdfString } from "./index.js";

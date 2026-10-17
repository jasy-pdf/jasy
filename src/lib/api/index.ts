// The intuitive API layer: declarative factory functions + input normalizers that compile
// down to the core engine elements. A thin, curated surface ON TOP of the engine - the
// core classes stay untouched and remain exported for power users.
export * from "./color.ts";
export * from "./insets.ts";
export * from "./gradient.ts";
export * from "./font-url.ts";
export { FontFormatError } from "../utils/ttf-parser.ts";
export * from "./dimension.ts";
export * from "./text.ts";
export * from "./layout.ts";
export * from "./content.ts";
export * from "./page-builder.ts";
export * from "./structure.ts";
export type { Diagnostic, DiagnosticCode, DiagnosticHandler } from "../common/diagnostics.ts";
export * from "./table.ts";
export * from "./forms.ts";
export * from "./descriptor.ts";

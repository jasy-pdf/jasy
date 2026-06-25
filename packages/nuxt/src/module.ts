import {
  defineNuxtModule,
  createResolver,
  addComponent,
  addImports,
  addImportsDir,
  addServerImports,
  addServerImportsDir,
} from "@nuxt/kit";

export interface ModuleOptions {
  /** Auto-register the jasy components (client) + the @jasy/pdf tree API (server) so they need no import. Default true. */
  autoImport?: boolean;
  /** Component name prefix, e.g. "Pdf" -> <PdfDocument>, <PdfText>. Default none. */
  prefix?: string;
}

// @jasy/vue components, registered for client templates.
const COMPONENTS = [
  "Document",
  "Page",
  "Column",
  "Row",
  "Box",
  "Padding",
  "Expanded",
  "Spacer",
  "Divider",
  "Image",
  "Text",
  "Paragraph",
  "Span",
  "Table",
  "TableRow",
  "TableCell",
  "Positioned",
  "DefaultTextStyle",
];

// @jasy/pdf tree factories, auto-imported in server/. These take the prefix like the components, so
// `prefix: "Pdf"` is consistent on both sides (<PdfDocument> in a template, PdfDocument(...) in server/).
const SERVER_FACTORIES = [
  "Document",
  "Page",
  "Column",
  "Row",
  "Box",
  "Padding",
  "Expanded",
  "Spacer",
  "Divider",
  "Image",
  "Text",
  "Paragraph",
  "span",
  "Table",
  "Positioned",
  "DefaultTextStyle",
];

// Render + unit helpers, auto-imported in server/. Never prefixed - a `PdfrenderToBytes` would be silly.
const SERVER_UTILS = ["renderToBytes", "renderPdf", "mm"];

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@jasy/nuxt",
    configKey: "jasy",
  },
  defaults: {
    autoImport: true,
  },
  setup(options) {
    const resolver = createResolver(import.meta.url);

    if (options.autoImport) {
      const prefix = options.prefix ?? "";
      for (const name of COMPONENTS) {
        addComponent({ name: `${prefix}${name}`, filePath: "@jasy/vue", export: name });
      }
      addServerImports([
        ...SERVER_FACTORIES.map((name) => ({ name, as: `${prefix}${name}`, from: "@jasy/pdf" })),
        ...SERVER_UTILS.map((name) => ({ name, from: "@jasy/pdf" })),
      ]);
      addImports([
        { name: "renderToPdf", from: "@jasy/vue" },
        { name: "renderToPdfString", from: "@jasy/vue" },
      ]);
    }

    // Helpers, always available: usePdf (client) + sendPdf/definePdfHandler (server).
    addImportsDir(resolver.resolve("./runtime/composables"));
    addServerImportsDir(resolver.resolve("./runtime/server/utils"));
  },
});

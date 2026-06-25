import { defineNuxtModule, addComponent } from "@nuxt/kit";

export interface ModuleOptions {
  /** Auto-register the jasy components so PDF SFCs use them without an import. Default true. */
  autoImport?: boolean;
  /** Component name prefix, e.g. "Pdf" -> <PdfDocument>, <PdfText>. Default none. */
  prefix?: string;
}

// The @jasy/vue component set, registered as Nuxt components.
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

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@jasy/nuxt",
    configKey: "jasy",
  },
  defaults: {
    autoImport: true,
  },
  setup(options) {
    if (!options.autoImport) return;

    const prefix = options.prefix ?? "";
    for (const name of COMPONENTS) {
      addComponent({ name: `${prefix}${name}`, filePath: "@jasy/vue", export: name });
    }
  },
});

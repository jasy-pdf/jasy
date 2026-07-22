import { dirname, join } from "node:path";
import {
  defineNuxtModule,
  createResolver,
  resolvePath,
  extendViteConfig,
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
  "PageBreak",
  "KeepTogether",
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
  // Navigation, transforms and page numbers.
  "Link",
  "Anchor",
  "Bookmark",
  "Rotated",
  "RotatedBox",
  "PageNumber",
  "PageCount",
];

// @jasy/pdf tree factories for server/, prefixed like the components so `prefix` is consistent both sides.
const SERVER_FACTORIES = [
  "Document",
  "Page",
  "Column",
  "Row",
  "Box",
  "Padding",
  "Expanded",
  "Spacer",
  "PageBreak",
  "keepTogether",
  "Divider",
  "Image",
  "Text",
  "Paragraph",
  "span",
  "Table",
  "Positioned",
  "DefaultTextStyle",
  "Link",
  "Anchor",
  "Bookmark",
  "Rotated",
  "RotatedBox",
  "PageNumber",
  "PageCount",
  // Server code is plain JS, so the closure primitive is usable here (unlike in a client template).
  "PageBuilder",
];

// Render + unit helpers for server/ - not prefixed.
const SERVER_UTILS = ["renderToBytes", "renderPdf", "mm"];

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "@jasy/nuxt",
    configKey: "jasy",
  },
  defaults: {
    autoImport: true,
  },
  async setup(options) {
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

    // jimp is server-only. @jasy/pdf swaps node-image (jimp) -> browser-image (canvas) via its `browser`
    // field, but Nuxt's Vite skips that for the transitive dist, so force it. Nitro is a separate build,
    // keeps jimp.
    const browserImage = join(dirname(await resolvePath("@jasy/pdf")), "platform/browser-image.js");
    extendViteConfig((config) => {
      config.resolve ||= {};
      const existing = config.resolve.alias;
      const alias = Array.isArray(existing)
        ? existing
        : Object.entries(existing ?? {}).map(([find, replacement]) => ({ find, replacement }));
      alias.push({ find: /^.*platform[\\/]node-image\.js$/, replacement: browserImage });
      config.resolve.alias = alias;

      // image-helper also imports jimp directly (grayscale) - tree-shaken in the build, but the dev scanner
      // still finds it, so exclude. fflate is the real client dep, pre-bundle it.
      config.optimizeDeps ||= {};
      config.optimizeDeps.include = [...(config.optimizeDeps.include ?? []), "fflate"];
      config.optimizeDeps.exclude = [...(config.optimizeDeps.exclude ?? []), "jimp"];
    });
  },
});

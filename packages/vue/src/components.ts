import { defineComponent, h, type App, type Plugin } from "vue";

// Wraps an engine host tag (`document`/`text`/…) as a component, forwarding props as attrs and the default
// slot as children. The devtools name stays `Jasy`-prefixed to avoid a native-element-name warning.
function host(tag: string, name: string) {
  return defineComponent({
    name: "Jasy" + name,
    inheritAttrs: false,
    setup(_props, { slots, attrs }) {
      return () => h(tag, { ...attrs }, slots.default?.());
    },
  });
}

export const Document = host("document", "Document");
export const Page = host("page", "Page");
export const Column = host("column", "Column");
export const Row = host("row", "Row");
export const Box = host("box", "Box");
export const Padding = host("padding", "Padding");
export const Expanded = host("expanded", "Expanded");
export const Spacer = host("spacer", "Spacer");
export const Divider = host("divider", "Divider");
export const Image = host("image", "Image");
export const Text = host("text", "Text");
export const Paragraph = host("paragraph", "Paragraph");
export const Span = host("span", "Span");

const components = {
  Document, Page, Column, Row, Box, Padding, Expanded, Spacer, Divider, Image, Text, Paragraph, Span,
};

// Register the components globally, optionally under a `prefix` to avoid name clashes with a UI library:
// `app.use(jasyVue, { prefix: "Pdf" })` → `<PdfRow>`, `<PdfText>`, …
export const jasyVue: Plugin = {
  install(app: App, options: { prefix?: string } = {}) {
    const prefix = options.prefix ?? "";
    for (const [name, comp] of Object.entries(components)) {
      app.component(prefix + name, comp);
    }
  },
};

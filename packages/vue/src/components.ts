import { defineComponent, h, type PropType } from "vue";
import type {
  ColorInput,
  Insets,
  ImageSource,
  FontSource,
  PageSizeInput,
  ColumnWidth,
} from "@jasy/pdf";

const colorProp = [String, Number, Object] as PropType<ColorInput>;
const insetsProp = [Number, Object, Array] as PropType<Insets>;

// `bold`/`italic` use `default: undefined` so an unset flag stays undefined (and inherits the
// DefaultTextStyle) while `<Text bold>` still coerces to true.
const textStyleProps = {
  size: Number,
  font: String,
  bold: { type: Boolean, default: undefined },
  italic: { type: Boolean, default: undefined },
  color: colorProp,
};
const textProps = {
  ...textStyleProps,
  align: String as PropType<"left" | "center" | "right">,
  lineHeight: Number,
  maxLines: Number,
  overflow: String as PropType<"clip" | "ellipsis">,
};
const stackProps = {
  gap: Number,
  justify: String as PropType<"start" | "center" | "end" | "between" | "around">,
  align: String as PropType<"start" | "center" | "end" | "stretch">,
};
const boxProps = {
  bg: colorProp,
  border: colorProp,
  borderTop: colorProp,
  borderRight: colorProp,
  borderBottom: colorProp,
  borderLeft: colorProp,
  borderWidth: Number,
  padding: insetsProp,
  width: Number,
  height: Number,
  radius: Number,
  relative: { type: Boolean, default: undefined },
  overflow: String as PropType<"hidden" | "visible">,
};
const imageProps = {
  src: [String, Object] as PropType<ImageSource>,
  width: Number,
  height: Number,
  fit: String as PropType<"none" | "contain" | "cover" | "fill">,
  radius: Number,
};
const dividerProps = { color: colorProp, thickness: Number, margin: insetsProp };
const pageProps = {
  size: [String, Object] as PropType<PageSizeInput>,
  orientation: String as PropType<"portrait" | "landscape">,
  margin: insetsProp,
  ...stackProps,
};
const documentProps = {
  ...textStyleProps,
  align: String as PropType<"left" | "center" | "right">,
  lineHeight: Number,
  meta: Object as PropType<{ title?: string; author?: string }>,
  fonts: Object as PropType<Record<string, FontSource>>,
};

const positionedProps = {
  top: Number,
  right: Number,
  bottom: Number,
  left: Number,
  h: String as PropType<"start" | "center" | "end">,
  v: String as PropType<"start" | "center" | "end">,
  x: Number,
  y: Number,
};
const defaultTextStyleProps = {
  ...textStyleProps,
  align: String as PropType<"left" | "center" | "right">,
  lineHeight: Number,
};

const tableProps = {
  columns: { type: Array as PropType<ColumnWidth[]>, required: true },
  gap: Number,
  rowGap: Number,
  colGap: Number,
  cellPadding: insetsProp,
  cellBorder: colorProp,
  rule: colorProp,
};

// Forward the typed props (+ any extra attrs) to the engine host tag; the default slot is the children.
const fwd =
  (tag: string) =>
  (props: any, { slots, attrs }: any) =>
  () =>
    h(tag, { ...attrs, ...props }, slots.default?.());

// defineComponent is called directly (not via a helper) so the props object's type reaches the
// component, giving template type-check + autocomplete. The devtools name stays `Jasy`-prefixed.
export const Document = defineComponent({
  name: "JasyDocument",
  inheritAttrs: false,
  props: documentProps,
  setup: fwd("document"),
});
// `<Page>` also takes `#header` / `#footer` named slots - laid out once, repeated on every physical page.
export const Page = defineComponent({
  name: "JasyPage",
  inheritAttrs: false,
  props: pageProps,
  setup(props, { slots }) {
    return () => {
      const kids: any[] = [];
      if (slots.header) kids.push(h("page-header", null, slots.header()));
      if (slots.footer) kids.push(h("page-footer", null, slots.footer()));
      if (slots.default) kids.push(...slots.default());
      return h("page", { ...props }, kids);
    };
  },
});
export const Column = defineComponent({
  name: "JasyColumn",
  inheritAttrs: false,
  props: stackProps,
  setup: fwd("column"),
});
export const Row = defineComponent({
  name: "JasyRow",
  inheritAttrs: false,
  props: stackProps,
  setup: fwd("row"),
});
export const Box = defineComponent({
  name: "JasyBox",
  inheritAttrs: false,
  props: boxProps,
  setup: fwd("box"),
});
export const Padding = defineComponent({
  name: "JasyPadding",
  inheritAttrs: false,
  props: { insets: insetsProp },
  setup: fwd("padding"),
});
export const Expanded = defineComponent({
  name: "JasyExpanded",
  inheritAttrs: false,
  props: { flex: Number },
  setup: fwd("expanded"),
});
export const Spacer = defineComponent({
  name: "JasySpacer",
  inheritAttrs: false,
  props: { flex: Number },
  setup: fwd("spacer"),
});
export const Divider = defineComponent({
  name: "JasyDivider",
  inheritAttrs: false,
  props: dividerProps,
  setup: fwd("divider"),
});
export const Image = defineComponent({
  name: "JasyImage",
  inheritAttrs: false,
  props: imageProps,
  setup: fwd("image"),
});
export const Text = defineComponent({
  name: "JasyText",
  inheritAttrs: false,
  props: textProps,
  setup: fwd("text"),
});
export const Paragraph = defineComponent({
  name: "JasyParagraph",
  inheritAttrs: false,
  props: textProps,
  setup: fwd("paragraph"),
});
export const Span = defineComponent({
  name: "JasySpan",
  inheritAttrs: false,
  props: textStyleProps,
  setup: fwd("span"),
});
// `<Table :columns>` holds `<TableRow>`s (mark one `header` to repeat it per page) of `<TableCell>`s.
export const Table = defineComponent({
  name: "JasyTable",
  inheritAttrs: false,
  props: tableProps,
  setup: fwd("table"),
});
export const TableRow = defineComponent({
  name: "JasyTableRow",
  inheritAttrs: false,
  props: { header: { type: Boolean, default: false } },
  setup: fwd("table-row"),
});
export const TableCell = defineComponent({
  name: "JasyTableCell",
  inheritAttrs: false,
  setup: fwd("table-cell"),
});
// Out-of-flow child, anchored to the nearest `<Box relative>` (or the page). Edges or `h`/`v` + `x`/`y`.
export const Positioned = defineComponent({
  name: "JasyPositioned",
  inheritAttrs: false,
  props: positionedProps,
  setup: fwd("positioned"),
});
// Re-defaults the text style for its subtree (the per-section counterpart to `<Document>` defaults).
export const DefaultTextStyle = defineComponent({
  name: "JasyDefaultTextStyle",
  inheritAttrs: false,
  props: defaultTextStyleProps,
  setup: fwd("default-text-style"),
});

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
  underline: { type: Boolean, default: undefined },
  strikethrough: { type: Boolean, default: undefined },
  /** Step the underline around descenders. Needs an embedded font. */
  skipInk: { type: Boolean, default: undefined },
  letterSpacing: Number,
};
// A link target. Shared by `<Text>`/`<Paragraph>` (links the whole run) and `<Span>` (links just that
// run). NOT part of `textStyleProps`: `<Document>` and `<DefaultTextStyle>` set defaults, they cannot link.
// Exactly one of the two, mirroring the `Link` factory.
const linkTargetProps = {
  /** An external URL. */
  href: String,
  /** The `name` of an `<Anchor>` elsewhere in the document. */
  to: String,
};
const textProps = {
  ...textStyleProps,
  ...linkTargetProps,
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
// Page-break control shared by `<Box>`/`<Column>`/`<Row>` (CSS break-before/after: page). NOT on
// `<Page>` (the top level cannot break before itself), so it is spread in explicitly, not via stackProps.
const breakProps = {
  breakBefore: { type: Boolean, default: undefined },
  breakAfter: { type: Boolean, default: undefined },
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
  ...breakProps,
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
  props: { ...stackProps, ...breakProps },
  setup: fwd("column"),
});
export const Row = defineComponent({
  name: "JasyRow",
  inheritAttrs: false,
  props: { ...stackProps, ...breakProps },
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
export const PageBreak = defineComponent({
  name: "JasyPageBreak",
  inheritAttrs: false,
  setup: fwd("page-break"),
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
  props: { ...textStyleProps, ...linkTargetProps },
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

// --- Navigation -------------------------------------------------------------------------------------
// Makes its child clickable. `href` opens a URL, `to` jumps to an `<Anchor>` in the same document.
// For a link on part of a line put `href`/`to` on a `<Span>` instead.
export const Link = defineComponent({
  name: "JasyLink",
  inheritAttrs: false,
  props: linkTargetProps,
  setup: fwd("link"),
});
// A named jump target for `<Link to="...">`. Layout-transparent: the child renders as it would alone.
export const Anchor = defineComponent({
  name: "JasyAnchor",
  inheritAttrs: false,
  props: { name: { type: String, required: true } },
  setup: fwd("anchor"),
});
// An entry in the viewer's outline sidebar. `level` nests it under the nearest preceding smaller level.
export const Bookmark = defineComponent({
  name: "JasyBookmark",
  inheritAttrs: false,
  props: { title: { type: String, required: true }, level: Number },
  setup: fwd("bookmark"),
});

// --- Transforms -------------------------------------------------------------------------------------
// Spins its child at any angle around its center, at PAINT time: the layout box stays unrotated, so
// siblings do not reflow. For a stamp or a watermark.
export const Rotated = defineComponent({
  name: "JasyRotated",
  inheritAttrs: false,
  props: { angle: { type: Number, required: true } },
  setup: fwd("rotated"),
});
// Layout-aware quarter-turns: a 90/270 turn swaps width and height, so siblings reflow around a vertical
// label. `turns` counts clockwise 90-degree steps.
export const RotatedBox = defineComponent({
  name: "JasyRotatedBox",
  inheritAttrs: false,
  props: { turns: { type: Number, required: true } },
  setup: fwd("rotated-box"),
});

// --- Page numbers -----------------------------------------------------------------------------------
// The current page / the document total, as text. Usable anywhere, not just in a `#footer`. `offset` is
// added to the number - use `-1` when a cover page should not count.
// (`PageBuilder` from the core is not exposed: it takes a closure, which a template cannot express.)
const pageNumberProps = { ...textStyleProps, align: String, lineHeight: Number, offset: Number };
export const PageNumber = defineComponent({
  name: "JasyPageNumber",
  inheritAttrs: false,
  props: pageNumberProps,
  setup: fwd("page-number"),
});
export const PageCount = defineComponent({
  name: "JasyPageCount",
  inheritAttrs: false,
  props: pageNumberProps,
  setup: fwd("page-count"),
});

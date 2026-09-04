import { defineComponent, h, type PropType } from "vue";
import type {
  ButtonActionInput,
  ColorInput,
  Direction,
  Hyphenator,
  Insets,
  ImageSource,
  FontSource,
  PageSizeInput,
  ColumnWidth,
  TextOverflow,
  TextRole,
  TextTransform,
  VerticalTextAlign,
} from "@jasy/pdf";

const colorProp = [String, Number, Object] as PropType<ColorInput>;
const insetsProp = [Number, Object, Array] as PropType<Insets>;
// A family name, or a STACK: each code point is drawn by the first family that has a glyph for it.
const fontProp = [String, Array] as PropType<string | string[]>;
// Text-internal alignment. Shared, because it is spread into four prop bags and drifted apart once.
const alignProp = String as PropType<"left" | "center" | "right" | "justify">;

// `bold`/`italic` use `default: undefined` so an unset flag stays undefined (and inherits the
// DefaultTextStyle) while `<Text bold>` still coerces to true.
const textStyleProps = {
  size: Number,
  font: fontProp,
  bold: { type: Boolean, default: undefined },
  italic: { type: Boolean, default: undefined },
  color: colorProp,
  underline: { type: Boolean, default: undefined },
  strikethrough: { type: Boolean, default: undefined },
  /** Step the underline around descenders. Needs an embedded font. */
  skipInk: { type: Boolean, default: undefined },
  letterSpacing: Number,
  /** Base writing direction (CSS `direction`): `"rtl"` starts the line on the right. */
  direction: String as PropType<Direction>,
  /** CSS `text-transform`: recase the text. */
  textTransform: String as PropType<TextTransform>,
  /** CSS `word-spacing`, in points: extra advance at every space. */
  wordSpacing: Number,
  /** CSS `text-indent`, in points: how far the FIRST line starts in. */
  textIndent: Number,
  /** Split a word wider than its box, anywhere, no hyphen (CSS `overflow-wrap: break-word`). */
  breakWord: { type: Boolean, default: undefined },
  /** The ligatures the font's designer drew (`fi`, `fl`, `ffi`). On by default; `false` opts out. */
  ligatures: { type: Boolean, default: undefined },
  /** Language-aware splitting: given a word, return its parts. Bring your own (`hyphen`, ...). */
  hyphenate: Function as PropType<Hyphenator>,
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
// `vertical-align` belongs to ONE run, not to a document's defaults - same reason as linkTargetProps.
const spanOnlyProps = {
  /** CSS `vertical-align`: raises a footnote marker or lowers an index. Shifts the baseline only -
   *  pass a smaller `size` too for the browser's `<sup>` look. */
  verticalAlign: String as PropType<VerticalTextAlign>,
};
const textProps = {
  ...textStyleProps,
  ...linkTargetProps,
  align: alignProp,
  lineHeight: Number,
  maxLines: Number,
  overflow: String as PropType<TextOverflow>,
  /** Minimum lines left behind at / carried over a page break (CSS `orphans`/`widows`, both 2). */
  orphans: Number,
  widows: Number,
  /** Accessibility role for the tagged structure tree: `"h1"`..`"h6"` or `"p"`. Semantic only. */
  role: String as PropType<TextRole>,
};
const stackProps = {
  gap: Number,
  justify: String as PropType<"start" | "center" | "end" | "between" | "around">,
  align: String as PropType<"start" | "center" | "end" | "stretch">,
};
// Page-break control shared by `<Box>`/`<Column>`/`<Row>` (CSS break-before/after: page +
// break-inside: avoid). NOT on `<Page>` (the top level cannot break before itself), so it is spread in
// explicitly, not via stackProps.
const breakProps = {
  breakBefore: { type: Boolean, default: undefined },
  breakAfter: { type: Boolean, default: undefined },
  keepTogether: { type: Boolean, default: undefined },
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
  align: alignProp,
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
  align: alignProp,
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
// Keeps its default-slot children on one page (CSS `break-inside: avoid`). Also available as the
// `keep-together` prop on `<Box>`/`<Column>`/`<Row>`.
export const KeepTogether = defineComponent({
  name: "JasyKeepTogether",
  inheritAttrs: false,
  setup: fwd("keep-together"),
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
  props: { ...textStyleProps, ...linkTargetProps, ...spanOnlyProps },
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
const pageNumberProps = { ...textStyleProps, align: alignProp, lineHeight: Number, offset: Number };
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

// ---------------------------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------------------------
// Two places where the template surface deliberately differs from the TypeScript one, both because a
// template has no second argument and no way to compose a helper inline:
//
//   - the list-like fields take their choices as `:options`, not as a second parameter;
//   - a field's LABEL is the default slot, so `<JasyCheckbox name="agree">I agree</JasyCheckbox>` writes
//     itself instead of being assembled from a Row, a Checkbox and a Text.
//
// There is deliberately no `v-model`. It would promise two-way binding, and a generated PDF writes
// nothing back - `:value` says exactly what happens.

/** Shared by every field: what the PDF format lets you say about one, regardless of its kind. */
const fieldProps = {
  /** The field name - unique in the document; you read the value back by it. */
  name: { type: String, required: true as const },
  /** Tooltip / accessible name shown on hover. */
  tooltip: String,
  /** Show the value but do not let the reader change it. */
  readOnly: { type: Boolean, default: undefined },
  /** Must be filled in before the form is submitted. */
  required: { type: Boolean, default: undefined },
  /** Hide the widget entirely - neither on screen nor in print. */
  hidden: { type: Boolean, default: undefined },
  /** Include the widget when printing (default true). */
  print: { type: Boolean, default: undefined },
  width: Number,
  height: Number,
  color: colorProp,
  border: colorProp,
  background: colorProp,
  borderWidth: Number,
};

/**
 * The label a field draws beside itself. Usually the default slot; the prop is there for the cases a slot
 * cannot cover - a computed string, or a field built in a `v-for`. The slot wins when both exist.
 *
 * Split into three sets rather than one, because the factories genuinely differ and a prop the engine
 * ignores is worse than a missing one: it looks like a knob and does nothing. Only a check box styles its
 * own label; a push button and a signature field draw theirs inside the widget; a radio group has no
 * single label at all - `labelSize`/`labelColor` there style the CHOICES.
 */
const labelOnly = { label: String };
const checkboxLabelProps = {
  ...labelOnly,
  labelSize: Number,
  labelColor: colorProp,
  labelGap: Number,
};
const choiceLabelProps = { labelSize: Number, labelColor: colorProp };

/** `["S", "M"]` or `[{ value: "DE", label: "Germany" }]` - both accepted. */
type ChoiceInput = string | { value: string; label?: string };
const optionsProp = {
  options: {
    type: Array as PropType<ChoiceInput[]>,
    required: true as const,
  },
};

/**
 * Forwards the default slot as a `label` PROP rather than as children: a field's label is text the
 * factory draws beside the box, not a child element, and passing it as a child would make it a sibling
 * the layout knows nothing about.
 */
const fwdLabelled =
  (tag: string) =>
  (props: any, { slots, attrs }: any) =>
  () => {
    const slot = slots.default?.();
    const fromSlot = slot
      ?.map((v: any) => (typeof v.children === "string" ? v.children : ""))
      .join("")
      .trim();
    const label = fromSlot || props.label;
    return h(tag, { ...attrs, ...props, ...(label ? { label } : {}) });
  };

export const TextField = defineComponent({
  name: "JasyTextField",
  inheritAttrs: false,
  props: {
    ...fieldProps,
    /** Initial value written into the document. */
    value: String,
    /** Accept several lines (give it a `height` to match). */
    multiline: { type: Boolean, default: undefined },
    /** Mask the characters - a password field. */
    password: { type: Boolean, default: undefined },
    /** How the value sits in the box. */
    align: String as PropType<"left" | "center" | "right">,
    maxLength: Number,
    fontSize: Number,
  },
  setup: fwd("text-field"),
});

export const Checkbox = defineComponent({
  name: "JasyCheckbox",
  inheritAttrs: false,
  props: {
    ...fieldProps,
    ...checkboxLabelProps,
    /** Whether it starts ticked. */
    checked: { type: Boolean, default: undefined },
    /** The value stored when ticked (default "Yes"). */
    onValue: String,
    /** Box side length in points. */
    size: Number,
  },
  setup: fwdLabelled("checkbox"),
});

export const RadioGroup = defineComponent({
  name: "JasyRadioGroup",
  inheritAttrs: false,
  props: {
    ...fieldProps,
    ...choiceLabelProps,
    ...optionsProp,
    /** Which option starts selected, by its value. */
    value: String,
    /** Button diameter in points. */
    size: Number,
    /** Space between the buttons. */
    gap: Number,
  },
  setup: fwd("radio-group"),
});

export const Dropdown = defineComponent({
  name: "JasyDropdown",
  inheritAttrs: false,
  props: {
    ...fieldProps,
    ...optionsProp,
    value: String,
    /** Let the reader type a value that is not in the list. */
    editable: { type: Boolean, default: undefined },
    fontSize: Number,
  },
  setup: fwd("dropdown"),
});

export const ListBox = defineComponent({
  name: "JasyListBox",
  inheritAttrs: false,
  props: {
    ...fieldProps,
    ...optionsProp,
    value: String,
    /** Several values selectable at once. */
    multiSelect: { type: Boolean, default: undefined },
    fontSize: Number,
  },
  setup: fwd("list-box"),
});

export const PushButton = defineComponent({
  name: "JasyPushButton",
  inheritAttrs: false,
  props: {
    ...fieldProps,
    ...labelOnly,
    /**
     * What pressing it does: `"reset"` clears the form, `{ submit: url }` posts it, `{ open: url }`
     * follows a link. Viewer support varies and is documented on the factory - reset is the one that
     * works everywhere.
     */
    action: [String, Object] as PropType<ButtonActionInput>,
    fontSize: Number,
  },
  setup: fwdLabelled("push-button"),
});

export const SignatureField = defineComponent({
  name: "JasySignatureField",
  inheritAttrs: false,
  props: {
    ...fieldProps,
    ...labelOnly,
  },
  setup: fwdLabelled("signature-field"),
});

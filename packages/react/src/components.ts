import { createElement as h, useContext, useRef, useState, type ReactNode } from "react";
import type {
  BoxOptions,
  CanvasOptions,
  CanvasPaint,
  CheckboxOptions,
  ChoiceOptionInput,
  DividerOptions,
  DocumentOptions,
  DropdownOptions,
  ExpandedOptions,
  FlowOptions,
  FlowPage,
  FontSource,
  ImageOptions,
  ImageSource,
  Insets,
  ListBoxOptions,
  PageNumberOptions,
  PageInfo,
  PageOptions,
  PositionedInsets,
  PushButtonOptions,
  RadioChoice,
  RadioGroupOptions,
  RegionOptions,
  SignatureFieldOptions,
  SplitViewOptions,
  StackOptions,
  SvgOptions,
  SvgSource,
  TableOptions,
  TextDefaults,
  TextFieldOptions,
  TextOptions,
  TextStyle,
} from "@jasy/pdf";
import { childDescriptors, flushNow, RenderSinkContext, type JNode } from "./renderer.js";

// Every prop type is the engine's own option type, so a new option is a typed prop the day it ships.
// The components only forward: the engine's `build()` reads the host tree they leave behind.

type WithChildren = { children?: ReactNode };
/** Text a field draws as its label: `<Checkbox name="agree">I agree</Checkbox>`. */
type LabelText = string | number | Array<string | number>;

export type DocumentProps = DocumentOptions &
  WithChildren & {
    /** Fonts by family name: the file's bytes, a path (Node) or a family of styles. */
    fonts?: Record<string, FontSource>;
  };
export type PageProps = Omit<PageOptions, "header" | "footer"> &
  WithChildren & {
    /** Laid out at the top of every physical page the content flows onto. */
    header?: ReactNode;
    /** Laid out at the bottom of every physical page the content flows onto. */
    footer?: ReactNode;
  };
export type StackProps = StackOptions & WithChildren;
export type BoxProps = BoxOptions & WithChildren;
export type PaddingProps = WithChildren & { insets?: Insets };
export type ExpandedProps = ExpandedOptions & WithChildren;
export type SpacerProps = { flex?: number };
export type DividerProps = DividerOptions;
export type ImageProps = ImageOptions & { src: ImageSource };
export type SvgProps = SvgOptions & { src: SvgSource };
export type CanvasProps = CanvasOptions & { paint: CanvasPaint };
export type TextProps = TextOptions & WithChildren;
export type SpanProps = TextStyle & WithChildren;
export type TableProps = Omit<TableOptions, "header"> & WithChildren;
export type TableRowProps = WithChildren & {
  /** Repeat this row at the top of every page the table flows onto. */
  header?: boolean;
};
export type FlowProps = Omit<FlowOptions, "template"> &
  WithChildren & {
    /** One page of the Flow, per page: the `Region`s in it are where the content goes. */
    page: (info: FlowPage) => ReactNode;
  };
export type RegionProps = RegionOptions;
export type SplitViewProps = SplitViewOptions & WithChildren;
export type PositionedProps = PositionedInsets & WithChildren;
export type DefaultTextStyleProps = TextDefaults & WithChildren;
/** Exactly one target: `href` opens a URL, `to` jumps to an `Anchor` of that name. */
export type LinkProps = WithChildren &
  ({ href: string; to?: never } | { to: string; href?: never });
export type AnchorProps = WithChildren & { name: string };
export type BookmarkProps = WithChildren & { title: string; level?: number };
export type RotatedProps = WithChildren & { angle: number };
export type RotatedBoxProps = WithChildren & { turns: number };
export type PageNumberProps = PageNumberOptions;
export type PageBuilderProps = {
  /** What to show, built from the page it lands on. */
  children: (info: PageInfo) => ReactNode;
};
export type TextFieldProps = TextFieldOptions;
export type CheckboxProps = CheckboxOptions & { children?: LabelText };
export type RadioGroupProps = RadioGroupOptions & {
  /** The choices: `["S", "M"]`, or `{ value, label }` when the label differs. */
  options: Array<string | RadioChoice>;
};
export type DropdownProps = DropdownOptions & { options: ChoiceOptionInput[] };
export type ListBoxProps = ListBoxOptions & { options: ChoiceOptionInput[] };
export type PushButtonProps = Omit<PushButtonOptions, "label"> & {
  label?: string;
  children?: LabelText;
};
export type SignatureFieldProps = SignatureFieldOptions & { children?: LabelText };

/** A component that leaves one host node of `type` with its props and children. */
function host<P extends object>(type: string, name: string) {
  const component = ({ children, ...props }: P & { children?: ReactNode }) =>
    h(type, props, children);
  component.displayName = name;
  return component as (props: P) => ReactNode;
}

/** A field whose children are its label: forwarded as the `label` prop the engine draws. */
function labelled<P extends { label?: string; children?: LabelText }>(type: string, name: string) {
  const component = ({ children, label, ...props }: P) => {
    const text = [children ?? []].flat().join("").trim();
    return h(type, { ...props, label: text || label });
  };
  component.displayName = name;
  return component;
}

export const Document = host<DocumentProps>("document", "Document");

/** A page template; `header` and `footer` repeat on every physical page the content flows onto. */
export function Page({ header, footer, children, ...props }: PageProps): ReactNode {
  return h(
    "page",
    props,
    header != null && h("page-header", null, header),
    footer != null && h("page-footer", null, footer),
    children,
  );
}

export const Column = host<StackProps>("column", "Column");
export const Row = host<StackProps>("row", "Row");
export const Box = host<BoxProps>("box", "Box");
export const Padding = host<PaddingProps>("padding", "Padding");
export const Expanded = host<ExpandedProps>("expanded", "Expanded");
export const Spacer = host<SpacerProps>("spacer", "Spacer");
export const PageBreak = host<object>("page-break", "PageBreak");
/** Keeps its children on one page (CSS `break-inside: avoid`); also a `keepTogether` prop on stacks. */
export const KeepTogether = host<WithChildren>("keep-together", "KeepTogether");
export const Divider = host<DividerProps>("divider", "Divider");
export const Image = host<ImageProps>("image", "Image");
export const Svg = host<SvgProps>("svg", "Svg");
export const Canvas = host<CanvasProps>("canvas", "Canvas");
export const Text = host<TextProps>("text", "Text");
export const Paragraph = host<TextProps>("paragraph", "Paragraph");
export const Span = host<SpanProps>("span", "Span");
export const Table = host<TableProps>("table", "Table");
export const TableRow = host<TableRowProps>("table-row", "TableRow");
export const TableCell = host<WithChildren>("table-cell", "TableCell");
export const Region = host<RegionProps>("region", "Region");
export const ColumnBreak = host<object>("column-break", "ColumnBreak");
export const SplitView = host<SplitViewProps>("split-view", "SplitView");
export const Positioned = host<PositionedProps>("positioned", "Positioned");
export const DefaultTextStyle = host<DefaultTextStyleProps>(
  "default-text-style",
  "DefaultTextStyle",
);
export const Link = host<LinkProps>("link", "Link");
export const Anchor = host<AnchorProps>("anchor", "Anchor");
export const Bookmark = host<BookmarkProps>("bookmark", "Bookmark");
export const Rotated = host<RotatedProps>("rotated", "Rotated");
export const RotatedBox = host<RotatedBoxProps>("rotated-box", "RotatedBox");
export const PageNumber = host<PageNumberProps>("page-number", "PageNumber");
export const PageCount = host<PageNumberProps>("page-count", "PageCount");
/** The page number within its `Page` (a section of the document), as text. */
export const SubPageNumber = host<PageNumberProps>("sub-page-number", "SubPageNumber");
/** How many pages its `Page` (a section of the document) produced, as text. */
export const SubPageCount = host<PageNumberProps>("sub-page-count", "SubPageCount");
export const TextField = host<TextFieldProps>("text-field", "TextField");
export const Checkbox = labelled<CheckboxProps>("checkbox", "Checkbox");
export const RadioGroup = host<RadioGroupProps>("radio-group", "RadioGroup");
export const Dropdown = host<DropdownProps>("dropdown", "Dropdown");
export const ListBox = host<ListBoxProps>("list-box", "ListBox");
export const PushButton = labelled<PushButtonProps>("push-button", "PushButton");
export const SignatureField = labelled<SignatureFieldProps>("signature-field", "SignatureField");

/**
 * Renders `render(info)` in place, in the tree, whenever the engine asks during layout - so hooks and
 * context work in it as anywhere else. Each request carries the `render` of the render that made it, so
 * a callback the engine kept from an earlier page still draws what that page rendered.
 */
function useRenderedOnRequest<T>(component: string, render: (info: T) => ReactNode) {
  const [asked, setAsked] = useState<{ info: T; render: (info: T) => ReactNode }>();
  const self = useRef<JNode>(null);
  const sink = useContext(RenderSinkContext);
  const request = (info: T) => {
    if (!self.current || !sink) {
      throw new Error(
        `@jasy/react: a <${component}> renders while the PDF is laid out - render the document ` +
          "with renderToPdf, which keeps it mounted until then.",
      );
    }
    flushNow(() => setAsked({ info, render }));
    if (sink.failure) throw sink.failure;
    const marker = self.current.children.find((c) => c.type === "rendered-on-request");
    return marker ? childDescriptors(marker) : [];
  };
  const rendered = asked && h("rendered-on-request", null, asked.render(asked.info));
  return { ref: self, request, rendered };
}

/**
 * Content flowing through the `Region`s of `page`: the first Region full, then the next, then the next
 * page. `page` is rendered for every page while the engine lays the document out.
 */
export function Flow({ page, children, ...props }: FlowProps): ReactNode {
  const { ref, request, rendered } = useRenderedOnRequest("Flow", page);
  return h("flow", { ...props, page: request, ref }, rendered, children);
}

/**
 * Content built from the page it lands on: `{({ pageNumber, pageCount }) => ...}` as its child. Place
 * it anywhere - a header, a footer, the body, a table cell. What it builds is placed whole on its page;
 * build nothing (`null`) to show it on some pages only.
 */
export function PageBuilder({ children }: PageBuilderProps): ReactNode {
  const { ref, request, rendered } = useRenderedOnRequest("PageBuilder", children);
  return h("page-builder", { build: request, ref }, rendered);
}

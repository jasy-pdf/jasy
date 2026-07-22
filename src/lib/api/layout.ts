import { ContainerElement } from "../elements/container-element.ts";
import { RowElement } from "../elements/row-element.ts";
import { RectangleElement } from "../elements/rectangle-element.ts";
import { ExpandedElement } from "../elements/layout/expanded-element.ts";
import { PaddingElement } from "../elements/layout/padding-element.ts";
import { PageBreakElement } from "../elements/layout/page-break-element.ts";
import { PositionedElement, PositionedInsets } from "../elements/layout/positioned-element.ts";
import { LinkElement } from "../elements/layout/link-element.ts";
import { BookmarkElement } from "../elements/layout/bookmark-element.ts";
import { AnchorElement } from "../elements/layout/anchor-element.ts";
import { RotatedElement } from "../elements/layout/rotated-element.ts";
import { RotatedBoxElement } from "../elements/layout/rotated-box-element.ts";
import { PDFElement } from "../elements/pdf-element.ts";
import { MainAlign, CrossAlign } from "../utils/flex-layout.ts";
import { ColorInput, toColor } from "./color.ts";
import { Insets, toEdges } from "./insets.ts";
import { SizeInput, toDimension } from "./dimension.ts";
import { splitArgs } from "./args.ts";

/** Options shared by the `Column` and `Row` stacks (locked §4). */
export interface StackOptions {
  /** Space inserted between children, in points. */
  gap?: number;
  /** Distribution along the main axis (CSS `justify-content`): start (default) · center · end ·
   *  between · around. */
  justify?: MainAlign;
  /** Position across the axis (CSS `align-items`): start (default) · center · end · stretch. */
  align?: CrossAlign;
  /** Size on each axis: points (fixed) or a percentage string like `"50%"` (a fraction of the offered
   *  space). Omit to fill the offered width / shrink-wrap to the children. A percentage needs a bounded
   *  axis (`height: "50%"` only resolves where the parent bounds the height). */
  width?: SizeInput;
  height?: SizeInput;
  /** Start this stack on a fresh page (CSS `break-before: page`, react-pdf's `break`). Ignored at the
   *  top of a page. */
  breakBefore?: boolean;
  /** Start everything after this stack on a fresh page (CSS `break-after: page`). */
  breakAfter?: boolean;
}

/** Splits `StackOptions` width/height into the fixed points + fraction the stack elements expect. */
function stackSize(opts: StackOptions) {
  const w = opts.width !== undefined ? toDimension(opts.width) : undefined;
  const h = opts.height !== undefined ? toDimension(opts.height) : undefined;
  return { width: w?.points, height: h?.points, widthFactor: w?.factor, heightFactor: h?.factor };
}

// The public default for `cross` is `start` (locked §5) - i.e. don't stretch a child unless
// asked. The engine default is `stretch`; the factory sets the friendlier public one.
const DEFAULT_CROSS: CrossAlign = "start";

/** A vertical stack. `Column(children)` or `Column(opts, children)`. */
export function Column(children: PDFElement[]): ContainerElement;
export function Column(opts: StackOptions, children: PDFElement[]): ContainerElement;
export function Column(a: StackOptions | PDFElement[], b?: PDFElement[]): ContainerElement {
  const { opts, children } = splitArgs<StackOptions>(a, b);
  return new ContainerElement({
    x: 0,
    y: 0,
    children,
    gap: opts.gap,
    main: opts.justify, // undefined → engine default `start` (matches §5)
    cross: opts.align ?? DEFAULT_CROSS,
    breakBefore: opts.breakBefore,
    breakAfter: opts.breakAfter,
    ...stackSize(opts),
  });
}

/** A horizontal stack. `Row(children)` or `Row(opts, children)`. */
export function Row(children: PDFElement[]): RowElement;
export function Row(opts: StackOptions, children: PDFElement[]): RowElement;
export function Row(a: StackOptions | PDFElement[], b?: PDFElement[]): RowElement {
  const { opts, children } = splitArgs<StackOptions>(a, b);
  return new RowElement({
    children,
    gap: opts.gap,
    main: opts.justify,
    cross: opts.align ?? DEFAULT_CROSS,
    breakBefore: opts.breakBefore,
    breakAfter: opts.breakAfter,
    ...stackSize(opts),
  });
}

/** A bordered / filled box that wraps its children (locked §4). */
export interface BoxOptions {
  /** Border (stroke) color. A box has a border only when `border` or `borderWidth` is set. */
  border?: ColorInput;
  /** Per-side border colors - override/add to `border`. Any of these makes the box draw
   *  individual side lines (sharp corners) instead of a uniform frame - this is how you get
   *  grid lines (e.g. a cell with only `borderBottom` + `borderRight`). */
  borderTop?: ColorInput;
  borderRight?: ColorInput;
  borderBottom?: ColorInput;
  borderLeft?: ColorInput;
  /** Border thickness in points (default 1 when a border is present). */
  borderWidth?: number;
  /** Background fill color. */
  bg?: ColorInput;
  /** Inner padding between the border and the children. */
  padding?: Insets;
  /** Size on each axis: a number of points (fixed) or a percentage string like `"50%"` (a fraction
   *  of the space the parent offers on that axis). Omit `width` to fill the offered width, omit
   *  `height` to shrink-wrap the content. A percentage only resolves in a bounded region. */
  width?: SizeInput;
  height?: SizeInput;
  /** Corner radius in points. */
  radius?: number;
  /** Make this box a positioning frame: `Positioned` children placed inside it resolve their
   *  offsets against this box (CSS `position: relative`). */
  relative?: boolean;
  /** `"hidden"` crops children to the box (rounded corners included); `"visible"` (default) lets a
   *  `Positioned` child spill over the edge. */
  overflow?: "hidden" | "visible";
  /** Start this box on a fresh page (CSS `break-before: page`, react-pdf's `break`). Ignored at the top
   *  of a page. */
  breakBefore?: boolean;
  /** Start everything after this box on a fresh page (CSS `break-after: page`). */
  breakAfter?: boolean;
}

/**
 * A box: maps to a `RectangleElement` (fill + border + radius) whose children are stacked
 * inside it, optionally inset by `padding` (a `PaddingElement` wrapping a `Column` of the
 * children). With no `border`/`borderWidth` the box has no outline (`borderWidth` 0).
 */
export function Box(children: PDFElement[]): RectangleElement;
export function Box(opts: BoxOptions, children: PDFElement[]): RectangleElement;
export function Box(a: BoxOptions | PDFElement[], b?: PDFElement[]): RectangleElement {
  const { opts, children } = splitArgs<BoxOptions>(a, b);

  const content =
    opts.padding !== undefined && children.length > 0
      ? [
          new PaddingElement({
            margin: toEdges(opts.padding),
            child: children.length === 1 ? children[0] : Column(children),
          }),
        ]
      : children;

  // A side is set if it (or the uniform `border`) is given. If ANY differs from a plain
  // uniform border, we hand the engine per-side colors (which draws individual lines).
  const sideKeys = [opts.borderTop, opts.borderRight, opts.borderBottom, opts.borderLeft];
  const hasPerSide = sideKeys.some((s) => s !== undefined);
  const side = (s?: ColorInput) => {
    const c = s ?? opts.border;
    return c !== undefined ? toColor(c) : undefined;
  };

  const hasBorder = opts.border !== undefined || opts.borderWidth !== undefined || hasPerSide;

  // A point size fills `width`/`height`; a percentage fills `widthFactor`/`heightFactor`.
  const w = opts.width !== undefined ? toDimension(opts.width) : undefined;
  const h = opts.height !== undefined ? toDimension(opts.height) : undefined;

  return new RectangleElement({
    x: 0,
    y: 0,
    children: content,
    color: opts.border !== undefined ? toColor(opts.border) : undefined,
    backgroundColor: opts.bg !== undefined ? toColor(opts.bg) : undefined,
    borderWidth: hasBorder ? (opts.borderWidth ?? 1) : 0,
    width: w?.points,
    height: h?.points,
    widthFactor: w?.factor,
    heightFactor: h?.factor,
    radius: opts.radius,
    sideBorders: hasPerSide
      ? {
          top: side(opts.borderTop),
          right: side(opts.borderRight),
          bottom: side(opts.borderBottom),
          left: side(opts.borderLeft),
        }
      : undefined,
    relative: opts.relative,
    overflow: opts.overflow,
    breakBefore: opts.breakBefore,
    breakAfter: opts.breakAfter,
  });
}

/** Insets a single child by `padding` (a number / `{x,y}` / `{top,…}` / 4-tuple). */
export function Padding(padding: Insets, child: PDFElement): PaddingElement {
  return new PaddingElement({ margin: toEdges(padding), child });
}

/**
 * Places a child OUT OF FLOW, relative to the nearest enclosing `relative` Box - or, with none, to
 * the page's content box. Two ways, pick per axis: pin to EDGES - `Positioned({ top, left, right,
 * bottom }, child)`, where a negative value pokes into / out of the corner (a badge, a tab, a
 * ribbon) and pinning both sides stretches; or ANCHOR + nudge - `Positioned({ h: "center", v: "end",
 * x: -10, y: -8 }, child)`, i.e. centered / end-aligned with a pixel offset. An edge wins over an
 * anchor on the same axis.
 *
 * A `Positioned` in a `Page`'s `header` or `footer` repeats on EVERY page and takes no space in the
 * band, which is how you draw a watermark, a draft stamp or a corner ribbon across a document. It
 * anchors to the page, not to the band, so `bottom: 0` is the foot of the page.
 */
export function Positioned(opts: PositionedInsets, child: PDFElement): PositionedElement {
  return new PositionedElement({ child, ...opts });
}

/**
 * Makes any `child` a clickable hyperlink - the child's whole box is the clickable region (an image, a
 * box, a row). Pass `href` for an external URL, or `to` for an internal jump to an `Anchor({ name })`
 * elsewhere in the document (e.g. a clickable table-of-contents row). Exactly one of the two. The link
 * draws nothing itself, so style the child - e.g. `Link({ href }, Text("jasy.dev", { color: "#1450aa" }))`
 * or `Link({ to: "chapter-2" }, Text("Chapter 2 ....... 5"))`. For a link on part of a line, put `href`/
 * `to` on a `span` instead (`Text([span("Visit "), span("jasy.dev", { href })])`), linking just that run.
 */
export function Link(opts: { href?: string; to?: string }, child: PDFElement): LinkElement {
  if ((opts.href === undefined) === (opts.to === undefined)) {
    throw new Error(
      "Link needs exactly one of `href` (external URL) or `to` (internal Anchor name).",
    );
  }
  return new LinkElement({ href: opts.href, dest: opts.to, child });
}

/**
 * Marks `child` as a named jump target that an internal `Link({ to: name })` can point at (a table of
 * contents linking to sections, cross-references). Layout-transparent: `child` renders exactly as it
 * would on its own, on whatever page it lands on. `name` must match the link's `to`.
 * `Anchor({ name: "chapter-2" }, Text("Chapter 2", { size: 24 }))`.
 */
export function Anchor(opts: { name: string }, child: PDFElement): AnchorElement {
  return new AnchorElement({ name: opts.name, child });
}

/**
 * Adds a bookmark to the document outline (the viewer's sidebar) that jumps to `child`. `title` is the
 * label; `level` (1-based, default 1) nests it - a `level: 2` bookmark hangs under the nearest preceding
 * `level: 1`, so you get a collapsible tree (chapters -> sections). It is layout-transparent: `child`
 * renders exactly as it would on its own. `Bookmark({ title: "Chapter 2", level: 1 }, Text("Chapter 2"))`.
 */
export function Bookmark(
  opts: { title: string; level?: number },
  child: PDFElement,
): BookmarkElement {
  return new BookmarkElement({ title: opts.title, level: opts.level, child });
}

/**
 * Rotates `child` at PAINT time by `angle` degrees (clockwise), around its center - like CSS
 * `transform: rotate()` / Flutter `Transform.rotate`. The child keeps its normal, unrotated layout box,
 * so siblings do NOT reflow around the spun shape and the drawing may overflow its slot. Pair it with a
 * `relative` Box + `Positioned` for a diagonal watermark or a "PAID" stamp laid over a document.
 */
export function Rotated(opts: { angle: number }, child: PDFElement): RotatedElement {
  return new RotatedElement({ angle: opts.angle, child });
}

/**
 * Rotates `child` by whole quarter-turns and, unlike `Rotated`, is LAYOUT-AWARE: a 90 / 270 turn swaps
 * the box's width and height so siblings reflow around it (a tall label becomes a narrow, tall strip
 * that reserves exactly that footprint). `turns` = clockwise 90-degree steps (1 = 90, 2 = 180, 3 = 270).
 * Use it for a vertical label beside a table; use `Rotated` for a free-angle stamp / watermark.
 */
export function RotatedBox(opts: { turns: number }, child: PDFElement): RotatedBoxElement {
  return new RotatedBoxElement({ turns: opts.turns, child });
}

/**
 * A flexible empty gap that pushes its siblings apart - `Row([a, Spacer(), b])` sends `a`
 * and `b` to the edges. `flex` weights it against other flex children (default 1).
 */
export function Spacer(flex: number = 1): ExpandedElement {
  return new ExpandedElement({ flex, child: Column([]) });
}

/**
 * A forced page break. Put it in a `Column` (or any vertical flow) and everything AFTER it starts on
 * a fresh page, no matter how much space is left: `Column([intro, PageBreak(), chapterTwo])`. It takes
 * no space and draws nothing. Works nested, and a break wins over `keepTogether`.
 */
export function PageBreak(): PageBreakElement {
  return new PageBreakElement();
}

export interface ExpandedOptions {
  /** Share of the leftover space vs other flex children (default 1). */
  flex?: number;
}

/**
 * Makes a child fill the leftover space along the stack's main axis (height in a Column,
 * width in a Row). `Expanded(child)` or `Expanded({ flex }, child)`.
 */
export function Expanded(child: PDFElement): ExpandedElement;
export function Expanded(opts: ExpandedOptions, child: PDFElement): ExpandedElement;
export function Expanded(a: ExpandedOptions | PDFElement, b?: PDFElement): ExpandedElement {
  const isOptsForm = b !== undefined;
  const opts = (isOptsForm ? a : {}) as ExpandedOptions;
  const child = (isOptsForm ? b : a) as PDFElement;
  return new ExpandedElement({ flex: opts.flex ?? 1, child });
}

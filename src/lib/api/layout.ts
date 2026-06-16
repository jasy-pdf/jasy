import { ContainerElement } from "../elements/container-element";
import { RowElement } from "../elements/row-element";
import { RectangleElement } from "../elements/rectangle-element";
import { PaddingElement } from "../elements/layout/padding-element";
import { PDFElement } from "../elements/pdf-element";
import { MainAlign, CrossAlign } from "../utils/flex-layout";
import { ColorInput, toColor } from "./color";
import { Insets, toEdges } from "./insets";
import { splitArgs } from "./args";

/** Options shared by the `Column` and `Row` stacks (locked §4). */
export interface StackOptions {
  /** Space inserted between children, in points. */
  gap?: number;
  /** Distribution along the stacking axis: start (default) · center · end · between · around. */
  main?: MainAlign;
  /** Position across the axis: start (default) · center · end · stretch. */
  cross?: CrossAlign;
}

// The public default for `cross` is `start` (locked §5) - i.e. don't stretch a child unless
// asked. The engine default is `stretch`; the factory sets the friendlier public one.
const DEFAULT_CROSS: CrossAlign = "start";

/** A vertical stack. `Column(children)` or `Column(opts, children)`. */
export function Column(children: PDFElement[]): ContainerElement;
export function Column(opts: StackOptions, children: PDFElement[]): ContainerElement;
export function Column(
  a: StackOptions | PDFElement[],
  b?: PDFElement[]
): ContainerElement {
  const { opts, children } = splitArgs<StackOptions>(a, b);
  return new ContainerElement({
    x: 0,
    y: 0,
    children,
    gap: opts.gap,
    main: opts.main, // undefined → engine default `start` (matches §5)
    cross: opts.cross ?? DEFAULT_CROSS,
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
    main: opts.main,
    cross: opts.cross ?? DEFAULT_CROSS,
  });
}

/** A bordered / filled box that wraps its children (locked §4). */
export interface BoxOptions {
  /** Border (stroke) colour. A box has a border only when `border` or `borderWidth` is set. */
  border?: ColorInput;
  /** Border thickness in points (default 1 when a border is present). */
  borderWidth?: number;
  /** Background fill colour. */
  bg?: ColorInput;
  /** Inner padding between the border and the children. */
  padding?: Insets;
  /** Fixed size; omit to fill the offered width and shrink-wrap the height. */
  width?: number;
  height?: number;
  /** Corner radius in points. */
  radius?: number;
}

/**
 * A box: maps to a `RectangleElement` (fill + border + radius) whose children are stacked
 * inside it, optionally inset by `padding` (a `PaddingElement` wrapping a `Column` of the
 * children). With no `border`/`borderWidth` the box has no outline (`borderWidth` 0).
 */
export function Box(children: PDFElement[]): RectangleElement;
export function Box(opts: BoxOptions, children: PDFElement[]): RectangleElement;
export function Box(
  a: BoxOptions | PDFElement[],
  b?: PDFElement[]
): RectangleElement {
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

  const hasBorder = opts.border !== undefined || opts.borderWidth !== undefined;

  return new RectangleElement({
    x: 0,
    y: 0,
    children: content,
    color: opts.border !== undefined ? toColor(opts.border) : undefined,
    backgroundColor: opts.bg !== undefined ? toColor(opts.bg) : undefined,
    borderWidth: hasBorder ? opts.borderWidth ?? 1 : 0,
    width: opts.width,
    height: opts.height,
    radius: opts.radius,
  });
}

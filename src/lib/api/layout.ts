import { ContainerElement } from "../elements/container-element";
import { RowElement } from "../elements/row-element";
import { RectangleElement } from "../elements/rectangle-element";
import { ExpandedElement } from "../elements/layout/expanded-element";
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
  /** Per-side border colours - override/add to `border`. Any of these makes the box draw
   *  individual side lines (sharp corners) instead of a uniform frame - this is how you get
   *  grid lines (e.g. a cell with only `borderBottom` + `borderRight`). */
  borderTop?: ColorInput;
  borderRight?: ColorInput;
  borderBottom?: ColorInput;
  borderLeft?: ColorInput;
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

  // A side is set if it (or the uniform `border`) is given. If ANY differs from a plain
  // uniform border, we hand the engine per-side colours (which draws individual lines).
  const sideKeys = [
    opts.borderTop,
    opts.borderRight,
    opts.borderBottom,
    opts.borderLeft,
  ];
  const hasPerSide = sideKeys.some((s) => s !== undefined);
  const side = (s?: ColorInput) => {
    const c = s ?? opts.border;
    return c !== undefined ? toColor(c) : undefined;
  };

  const hasBorder =
    opts.border !== undefined || opts.borderWidth !== undefined || hasPerSide;

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
    sideBorders: hasPerSide
      ? {
          top: side(opts.borderTop),
          right: side(opts.borderRight),
          bottom: side(opts.borderBottom),
          left: side(opts.borderLeft),
        }
      : undefined,
  });
}

/** Insets a single child by `padding` (a number / `{x,y}` / `{top,…}` / 4-tuple). */
export function Padding(padding: Insets, child: PDFElement): PaddingElement {
  return new PaddingElement({ margin: toEdges(padding), child });
}

/**
 * A flexible empty gap that pushes its siblings apart - `Row([a, Spacer(), b])` sends `a`
 * and `b` to the edges. `flex` weights it against other flex children (default 1).
 */
export function Spacer(flex: number = 1): ExpandedElement {
  return new ExpandedElement({ flex, child: Column([]) });
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
export function Expanded(
  a: ExpandedOptions | PDFElement,
  b?: PDFElement
): ExpandedElement {
  const isOptsForm = b !== undefined;
  const opts = (isOptsForm ? a : {}) as ExpandedOptions;
  const child = (isOptsForm ? b : a) as PDFElement;
  return new ExpandedElement({ flex: opts.flex ?? 1, child });
}

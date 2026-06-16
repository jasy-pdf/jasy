import { ContainerElement } from "../elements/container-element";
import { RowElement } from "../elements/row-element";
import { PDFElement } from "../elements/pdf-element";
import { MainAlign, CrossAlign } from "../utils/flex-layout";
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

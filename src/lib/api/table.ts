import { PDFElement, LayoutContext } from "../elements/pdf-element.ts";
import { BoxConstraints } from "../layout/box-constraints.ts";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element.ts";
import { DeferredElement } from "../elements/layout/deferred-element.ts";
import { StructGroup } from "../elements/layout/struct-group.ts";
import { Column, Row, Box, Expanded, Padding } from "./layout.ts";
import { Text } from "./text.ts";
import { Insets } from "./insets.ts";
import { ColorInput } from "./color.ts";

/**
 * A column width, as in CSS grid with points for units: a `number` of points (fixed), an `"Nfr"`
 * fraction (splits the leftover width, never narrower than its longest word), `"auto"` (as wide as the
 * widest cell in that column, giving way down to its longest word when the table would not fit), or
 * `"minmax(40, auto)"` (like `auto`, but never narrower than 40pt). Measured at layout time.
 */
export type ColumnWidth = number | string;

/** A table cell: any element, or a string (wrapped in `Text`). */
export type Cell = PDFElement | string;

export interface TableOptions {
  /** One entry per column: a fixed point width, an `"Nfr"` fraction, `"auto"` or `"minmax(<pt>, auto)"`. */
  columns: ColumnWidth[];
  /** A header row that REPEATS at the top of every page the table flows onto. */
  header?: Cell[];
  /** Gap between both columns and rows (default 0). */
  gap?: number;
  /** Gap between rows (overrides `gap`). */
  rowGap?: number;
  /** Gap between columns (overrides `gap`). */
  colGap?: number;
  /** Padding inside every cell (default none). */
  cellPadding?: Insets;
  /** Grid line color around every cell. Draws the complete grid once - don't add your own
   *  frame Box, or the outer edges double up. */
  cellBorder?: ColorInput;
  /** A single thin horizontal rule under the header row and along the foot of the table (e.g. a
   *  light-gray separator). Independent of `cellBorder`, which draws the full grid. */
  rule?: ColorInput;
}

function asElement(c: Cell): PDFElement {
  return typeof c === "string" ? Text(c) : c;
}

/** `"2fr"` → 2, `"fr"` → 1; not a fraction → null. */
function fractionOf(col: ColumnWidth): number | null {
  if (typeof col !== "string" || !col.endsWith("fr")) return null;
  const n = parseFloat(col);
  return Number.isFinite(n) ? n : 1;
}

const MINMAX_AUTO = /^minmax\(\s*(\d+(?:\.\d+)?)\s*,\s*auto\s*\)$/;

/**
 * The floor of a content-sized column: 0 for `"auto"`, N for `"minmax(N, auto)"`, null for any other
 * width. Other `minmax()` forms are not supported yet and say so, rather than being read as something else.
 */
function autoMinimum(col: ColumnWidth): number | null {
  if (col === "auto") return 0;
  if (typeof col !== "string" || !col.startsWith("minmax(")) return null;
  const min = MINMAX_AUTO.exec(col);
  if (!min) {
    throw new Error(
      `Unsupported column width "${col}" - minmax() takes a minimum in points and "auto", e.g. "minmax(40, auto)"`,
    );
  }
  return parseFloat(min[1]!);
}

/**
 * What the cells of column `i` need: `max` is the widest cell on one line (max-content), `min` the
 * widest piece that cannot break (min-content, its longest word).
 */
function cellWidths(
  opts: TableOptions,
  rows: Cell[][],
  i: number,
  ctx: LayoutContext,
): { min: number; max: number } {
  // The composed cell sits in a 1pt-border Box (border-box) that eats 1pt each side, which the
  // measured content doesn't include; add it back, and `ceil` so a single-word cell can't land
  // a hair over the width and wrap to an empty first line.
  const slack = opts.cellBorder !== undefined || opts.rule !== undefined ? 2 : 0;
  let min = 0;
  let max = 0;
  for (const cell of [opts.header?.[i], ...rows.map((r) => r[i])]) {
    if (cell === undefined) continue;
    const el =
      opts.cellPadding !== undefined ? Padding(opts.cellPadding, asElement(cell)) : asElement(cell);
    max = Math.max(max, el.measure(BoxConstraints.loose(Infinity, Infinity), ctx).width);
    min = Math.max(min, el.minIntrinsicMain(true, ctx));
  }
  return { min: Math.ceil(min + slack), max: Math.ceil(max + slack) };
}

/** Grows `lo` toward `hi` by `extra`, in equal steps - each column stops at its own `hi`. */
function growEvenly(lo: number[], hi: number[], extra: number): number[] {
  const out = [...lo];
  let open = out.map((_, k) => k).filter((k) => hi[k]! > out[k]!);
  while (extra > 1e-9 && open.length > 0) {
    const each = extra / open.length;
    for (const k of open) {
      const add = Math.min(each, hi[k]! - out[k]!);
      out[k]! += add;
      extra -= add;
    }
    open = open.filter((k) => hi[k]! - out[k]! > 1e-9);
  }
  return out;
}

/**
 * The column widths for a table `width` wide, as CSS grid sizes its tracks. An `"auto"` column takes
 * its widest cell while that leaves every `fr` column its longest word; when it does not, the `auto`
 * columns give way evenly, down to their own longest word. The `fr` columns then share what is left -
 * one whose share would be narrower than its longest word gets exactly that, and the table overflows
 * instead of drawing words over each other. With no width to fit (a table in a Row), nothing gives way.
 */
function resolveColumns(
  opts: TableOptions,
  rows: Cell[][],
  ctx: LayoutContext,
  width: number,
): ColumnWidth[] {
  const columns = opts.columns;
  const colGap = opts.colGap ?? opts.gap ?? 0;
  const room = width - Math.max(0, columns.length - 1) * colGap;
  const fixed = columns.reduce<number>((n, c) => n + (typeof c === "number" ? c : 0), 0);

  const autos = columns.flatMap((c, i) => (autoMinimum(c) === null ? [] : [i]));
  const fractions = Number.isFinite(room)
    ? columns.flatMap((c, i) => (fractionOf(c) === null ? [] : [i]))
    : [];
  const need = new Map<number, { min: number; max: number }>();
  for (const i of [...autos, ...fractions]) need.set(i, cellWidths(opts, rows, i, ctx));

  const resolved = [...columns];
  // 1. The auto columns: their widest cell, or less while an fr column would lose its longest word.
  const lo = autos.map((i) => Math.max(autoMinimum(columns[i]!)!, need.get(i)!.min));
  const hi = autos.map((i) => Math.max(autoMinimum(columns[i]!)!, need.get(i)!.max));
  const frMin = fractions.reduce((n, i) => n + need.get(i)!.min, 0);
  const free = room - fixed - frMin;
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  const autoWidths =
    free >= sum(hi) ? hi : free <= sum(lo) ? lo : growEvenly(lo, hi, free - sum(lo));
  autos.forEach((i, k) => (resolved[i] = autoWidths[k]!));

  // 2. The fr columns share the rest; one that would get less than its longest word is fixed at it.
  let left = room - fixed - sum(autoWidths);
  let flexible = fractions;
  for (;;) {
    const unit = left / flexible.reduce((n, i) => n + fractionOf(columns[i]!)!, 0);
    const short = flexible.filter((i) => need.get(i)!.min > fractionOf(columns[i]!)! * unit);
    if (short.length === 0) break;
    for (const i of short) {
      resolved[i] = need.get(i)!.min;
      left -= need.get(i)!.min;
    }
    flexible = flexible.filter((i) => !short.includes(i));
  }
  return resolved;
}

/** Builds the table tree for already-resolved column widths (no `"auto"`). */
function composeTable(opts: TableOptions, rows: Cell[][], columns: ColumnWidth[]): PDFElement {
  const { cellPadding } = opts;
  const colGap = opts.colGap ?? opts.gap ?? 0;
  const rowGap = opts.rowGap ?? opts.gap ?? 0;
  const cb = opts.cellBorder;
  const rule = opts.rule;

  // The complete grid, once: every cell bottom+right, first row also top, first col also left.
  const borderFor = (firstRow: boolean, firstCol: boolean) =>
    cb === undefined
      ? {}
      : {
          borderBottom: cb,
          borderRight: cb,
          ...(firstRow ? { borderTop: cb } : {}),
          ...(firstCol ? { borderLeft: cb } : {}),
        };

  // `ruled` rows get just a bottom line (the header underline / the table foot), without the full grid.
  const wrap = (
    cell: Cell,
    col: ColumnWidth,
    firstRow: boolean,
    firstCol: boolean,
    ruled: boolean,
    isHeader: boolean,
  ): PDFElement => {
    const content =
      cellPadding !== undefined ? Padding(cellPadding, asElement(cell)) : asElement(cell);
    // Tag the cell (TH for a header cell, else TD). StructGroup is layout-transparent - visually nothing
    // changes; it only nests the cell's content under a table-cell element in the accessible structure tree.
    const inner = new StructGroup({ role: isHeader ? "TH" : "TD", child: content });
    // The border lives on the wrapper, which stretches to the row height (crisp lines).
    const border = {
      ...borderFor(firstRow, firstCol),
      ...(ruled && rule !== undefined ? { borderBottom: rule } : {}),
    };
    const boxed = cb !== undefined || (ruled && rule !== undefined);
    // The columns are the grid: a row never shrinks one on its own, or its cells leave their columns.
    if (typeof col === "number") return Box({ width: col, flexShrink: 0, ...border }, [inner]);
    return Expanded({ flex: fractionOf(col)! }, boxed ? Box({ ...border }, [inner]) : inner);
  };

  // align:stretch → equal-height cells, so a wrapping cell keeps the row's bottom rule straight.
  const buildRow = (cells: Cell[], firstRow: boolean, ruled = false, isHeader = false) =>
    new StructGroup({
      role: "TR",
      child: Row(
        { gap: colGap, align: "stretch" },
        cells.map((cell, i) => wrap(cell, columns[i] ?? "1fr", firstRow, i === 0, ruled, isHeader)),
      ),
    });

  // The first row (which gets the top border) is the header if present, else body row 0.
  // `rule` underlines the header and the last body row (the table foot).
  const last = rows.length - 1;
  const body = Column(
    { gap: rowGap },
    rows.map((cells, idx) =>
      buildRow(cells, !opts.header && idx === 0, rule !== undefined && idx === last),
    ),
  );

  const table = opts.header
    ? new RepeatingHeaderElement(
        buildRow(opts.header, true, rule !== undefined, true),
        body,
        rowGap,
      )
    : body;
  return new StructGroup({ role: "Table", child: table });
}

/**
 * A `Column` of `Row`s. Fixed-point columns sit in a fixed-width `Box`, `"Nfr"` fractions
 * become `Expanded`, so columns align across rows. Being a Column of atomic Rows, it
 * paginates at row boundaries for free (a row that doesn't fit moves whole). `"auto"`
 * columns are resolved at layout time (a `DeferredElement`), once metrics are available.
 */
export function Table(opts: TableOptions, rows: Cell[][]): PDFElement {
  // Checked here, where the table is written, not at layout: a typo names its line.
  for (const col of opts.columns) {
    if (typeof col !== "number" && fractionOf(col) === null && autoMinimum(col) === null) {
      throw new Error(
        `Unsupported column width "${col}" - use a number of points, "<n>fr", "auto" or "minmax(<pt>, auto)"`,
      );
    }
  }
  if (opts.columns.some((c) => typeof c !== "number")) {
    return new DeferredElement((ctx, width) =>
      composeTable(opts, rows, resolveColumns(opts, rows, ctx, width)),
    );
  }
  return composeTable(opts, rows, opts.columns);
}

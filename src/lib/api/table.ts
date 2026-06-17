import { PDFElement, LayoutContext } from "../elements/pdf-element";
import { BoxConstraints } from "../layout/box-constraints";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element";
import { DeferredElement } from "../elements/layout/deferred-element";
import { Column, Row, Box, Expanded, Padding } from "./layout";
import { Text } from "./text";
import { Insets } from "./insets";
import { ColorInput } from "./color";

/**
 * A column width: a `number` of points (fixed), an `"Nfr"` fraction (splits the leftover
 * width), or `"auto"` (as wide as the widest cell in that column - measured at layout time).
 */
export type ColumnWidth = number | string;

/** A table cell: any element, or a string (wrapped in `Text`). */
export type Cell = PDFElement | string;

export interface TableOptions {
  /** One entry per column: a fixed point width, an `"Nfr"` fraction, or `"auto"`. */
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
  /** Grid line colour around every cell. Draws the complete grid once - don't add your own
   *  frame Box, or the outer edges double up. */
  cellBorder?: ColorInput;
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

/** The cell's unbounded (max-content) width - what an `"auto"` column sizes to. */
function naturalWidth(cell: Cell, cellPadding: Insets | undefined, ctx: LayoutContext): number {
  const el = cellPadding !== undefined ? Padding(cellPadding, asElement(cell)) : asElement(cell);
  return el.calculateLayout(BoxConstraints.loose(Infinity, Infinity), { x: 0, y: 0 }, ctx).width;
}

/** Replaces every `"auto"` column with the widest cell width measured down that column. */
function resolveAutoColumns(
  opts: TableOptions,
  rows: Cell[][],
  ctx: LayoutContext
): ColumnWidth[] {
  // The composed cell sits in a 1pt-border Box (border-box) that eats 1pt each side, which the
  // measured content doesn't include; add it back, and `ceil` so a single-word cell can't land
  // a hair over the width and wrap to an empty first line.
  const slack = opts.cellBorder !== undefined ? 2 : 0;
  return opts.columns.map((col, i) => {
    if (col !== "auto") return col;
    let w = opts.header ? naturalWidth(opts.header[i], opts.cellPadding, ctx) : 0;
    for (const r of rows) {
      if (r[i] !== undefined) w = Math.max(w, naturalWidth(r[i], opts.cellPadding, ctx));
    }
    return Math.ceil(w + slack);
  });
}

/** Builds the table tree for already-resolved column widths (no `"auto"`). */
function composeTable(
  opts: TableOptions,
  rows: Cell[][],
  columns: ColumnWidth[]
): PDFElement {
  const { cellPadding } = opts;
  const colGap = opts.colGap ?? opts.gap ?? 0;
  const rowGap = opts.rowGap ?? opts.gap ?? 0;
  const cb = opts.cellBorder;

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

  const wrap = (cell: Cell, col: ColumnWidth, firstRow: boolean, firstCol: boolean): PDFElement => {
    const inner =
      cellPadding !== undefined ? Padding(cellPadding, asElement(cell)) : asElement(cell);
    // The border lives on the wrapper, which stretches to the row height (crisp lines).
    const border = borderFor(firstRow, firstCol);
    if (typeof col === "number") return Box({ width: col, ...border }, [inner]);
    const fr = fractionOf(col);
    if (fr !== null)
      return Expanded({ flex: fr }, cb !== undefined ? Box({ ...border }, [inner]) : inner);
    throw new Error(`Unsupported column width "${col}" - use a number of points or "<n>fr"`);
  };

  // cross:stretch → equal-height cells, so a wrapping cell keeps the row's bottom rule straight.
  const buildRow = (cells: Cell[], firstRow: boolean) =>
    Row(
      { gap: colGap, cross: "stretch" },
      cells.map((cell, i) => wrap(cell, columns[i] ?? "1fr", firstRow, i === 0))
    );

  // The first row (which gets the top border) is the header if present, else body row 0.
  const body = Column(
    { gap: rowGap },
    rows.map((cells, idx) => buildRow(cells, !opts.header && idx === 0))
  );

  return opts.header
    ? new RepeatingHeaderElement(buildRow(opts.header, true), body, rowGap)
    : body;
}

/**
 * A `Column` of `Row`s. Fixed-point columns sit in a fixed-width `Box`, `"Nfr"` fractions
 * become `Expanded`, so columns align across rows. Being a Column of atomic Rows, it
 * paginates at row boundaries for free (a row that doesn't fit moves whole). `"auto"`
 * columns are resolved at layout time (a `DeferredElement`), once metrics are available.
 */
export function Table(opts: TableOptions, rows: Cell[][]): PDFElement {
  if (opts.columns.some((c) => c === "auto")) {
    return new DeferredElement((ctx) =>
      composeTable(opts, rows, resolveAutoColumns(opts, rows, ctx))
    );
  }
  return composeTable(opts, rows, opts.columns);
}

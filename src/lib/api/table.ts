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

/** The cell's unbounded (max-content) width - what an `"auto"` column sizes to. */
function naturalWidth(cell: Cell, cellPadding: Insets | undefined, ctx: LayoutContext): number {
  const el = cellPadding !== undefined ? Padding(cellPadding, asElement(cell)) : asElement(cell);
  return el.calculateLayout(BoxConstraints.loose(Infinity, Infinity), { x: 0, y: 0 }, ctx).width;
}

/** Replaces every `"auto"` column with the widest cell width measured down that column. */
function resolveAutoColumns(opts: TableOptions, rows: Cell[][], ctx: LayoutContext): ColumnWidth[] {
  // The composed cell sits in a 1pt-border Box (border-box) that eats 1pt each side, which the
  // measured content doesn't include; add it back, and `ceil` so a single-word cell can't land
  // a hair over the width and wrap to an empty first line.
  const slack = opts.cellBorder !== undefined || opts.rule !== undefined ? 2 : 0;
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
    const inner = new StructGroup(isHeader ? "TH" : "TD", content);
    // The border lives on the wrapper, which stretches to the row height (crisp lines).
    const border = {
      ...borderFor(firstRow, firstCol),
      ...(ruled && rule !== undefined ? { borderBottom: rule } : {}),
    };
    const boxed = cb !== undefined || (ruled && rule !== undefined);
    if (typeof col === "number") return Box({ width: col, ...border }, [inner]);
    const fr = fractionOf(col);
    if (fr !== null) return Expanded({ flex: fr }, boxed ? Box({ ...border }, [inner]) : inner);
    throw new Error(`Unsupported column width "${col}" - use a number of points or "<n>fr"`);
  };

  // align:stretch → equal-height cells, so a wrapping cell keeps the row's bottom rule straight.
  const buildRow = (cells: Cell[], firstRow: boolean, ruled = false, isHeader = false) =>
    new StructGroup(
      "TR",
      Row(
        { gap: colGap, align: "stretch" },
        cells.map((cell, i) => wrap(cell, columns[i] ?? "1fr", firstRow, i === 0, ruled, isHeader)),
      ),
    );

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
  return new StructGroup("Table", table);
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
      composeTable(opts, rows, resolveAutoColumns(opts, rows, ctx)),
    );
  }
  return composeTable(opts, rows, opts.columns);
}

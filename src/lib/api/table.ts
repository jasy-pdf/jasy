import { PDFElement } from "../elements/pdf-element";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element";
import { Column, Row, Box, Expanded, Padding } from "./layout";
import { Text } from "./text";
import { Insets } from "./insets";

/**
 * A column width: a `number` of points (fixed), or a fraction string like `"1fr"` / `"2fr"`
 * (splits the leftover width). `"auto"` (size to the widest cell across rows) needs
 * cross-row intrinsic measuring and is not supported yet.
 */
export type ColumnWidth = number | string;

/** A table cell: any element, or a string (wrapped in `Text`). */
export type Cell = PDFElement | string;

export interface TableOptions {
  /** One entry per column: a fixed point width or an `"Nfr"` fraction. */
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

/**
 * A table: a `Column` of `Row`s built from the cell grid, with column widths resolved from
 * `columns` (fixed point widths sit in a fixed-width `Box`; `"Nfr"` fractions become
 * `Expanded`, so they align across rows and share the leftover width). Because it is just a
 * Column of atomic Rows, it paginates at ROW boundaries for free - a row that doesn't fit
 * moves whole to the next page. (A repeating header row across pages is a later feature.)
 */
export function Table(opts: TableOptions, rows: Cell[][]): PDFElement {
  const { columns, cellPadding } = opts;
  const colGap = opts.colGap ?? opts.gap ?? 0;
  const rowGap = opts.rowGap ?? opts.gap ?? 0;

  const wrap = (cell: Cell, col: ColumnWidth): PDFElement => {
    const inner =
      cellPadding !== undefined ? Padding(cellPadding, asElement(cell)) : asElement(cell);
    if (typeof col === "number") return Box({ width: col }, [inner]);
    const fr = fractionOf(col);
    if (fr !== null) return Expanded({ flex: fr }, inner);
    throw new Error(
      `Unsupported column width "${col}" - use a number of points or "<n>fr" ("auto" is not supported yet)`
    );
  };

  const buildRow = (cells: Cell[]) =>
    Row(
      { gap: colGap },
      cells.map((cell, i) => wrap(cell, columns[i] ?? "1fr"))
    );

  const body = Column({ gap: rowGap }, rows.map(buildRow));

  // A repeating header gets its own element so it reappears on every page; otherwise the
  // table is just the body Column (still paginates at row boundaries).
  return opts.header
    ? new RepeatingHeaderElement(buildRow(opts.header), body, rowGap)
    : body;
}

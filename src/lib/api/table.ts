import { PDFElement } from "../elements/pdf-element";
import { RepeatingHeaderElement } from "../elements/layout/repeating-header-element";
import { Column, Row, Box, Expanded, Padding } from "./layout";
import { Text } from "./text";
import { Insets } from "./insets";
import { ColorInput } from "./color";

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

/**
 * A `Column` of `Row`s. Fixed-point columns sit in a fixed-width `Box`, `"Nfr"` fractions
 * become `Expanded`, so columns align across rows. Being a Column of atomic Rows, it
 * paginates at row boundaries for free (a row that doesn't fit moves whole).
 */
export function Table(opts: TableOptions, rows: Cell[][]): PDFElement {
  const { columns, cellPadding } = opts;
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

  const wrap = (
    cell: Cell,
    col: ColumnWidth,
    firstRow: boolean,
    firstCol: boolean
  ): PDFElement => {
    const inner =
      cellPadding !== undefined ? Padding(cellPadding, asElement(cell)) : asElement(cell);
    // The border lives on the wrapper, which stretches to the row height (crisp lines).
    const border = borderFor(firstRow, firstCol);
    if (typeof col === "number") return Box({ width: col, ...border }, [inner]);
    const fr = fractionOf(col);
    if (fr !== null)
      return Expanded(
        { flex: fr },
        cb !== undefined ? Box({ ...border }, [inner]) : inner
      );
    throw new Error(
      `Unsupported column width "${col}" - use a number of points or "<n>fr" ("auto" is not supported yet)`
    );
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

  // A repeating header gets its own element so it reappears on every page; otherwise the
  // table is just the body Column (still paginates at row boundaries).
  return opts.header
    ? new RepeatingHeaderElement(buildRow(opts.header, true), body, rowGap)
    : body;
}

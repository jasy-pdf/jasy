import { describe, it, expect } from "vitest";
import { Table } from "../../../src/lib/api/table";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { RowElement } from "../../../src/lib/elements/row-element";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { ExpandedElement } from "../../../src/lib/elements/layout/expanded-element";
import { RepeatingHeaderElement } from "../../../src/lib/elements/layout/repeating-header-element";
import { DeferredElement } from "../../../src/lib/elements/layout/deferred-element";
import { PDFElement } from "../../../src/lib/elements/pdf-element";
import { StructGroup } from "../../../src/lib/elements/layout/struct-group";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { Document, Page, renderToBytes } from "../../../src/lib/api/structure.ts";

// Tables now wrap the table / rows / cells in layout-transparent StructGroups (accessibility). These
// helpers see through them, so the tests still assert the underlying Column / Row / Box structure.
const unwrap = (el: PDFElement): PDFElement =>
  el instanceof StructGroup ? unwrap((el.getProps() as { child: PDFElement }).child) : el;
const rowsOf = (t: PDFElement) =>
  (unwrap(t).getProps() as { children: PDFElement[] }).children.map(unwrap) as RowElement[];
const cellsOf = (r: RowElement) => (unwrap(r).getProps() as { children: unknown[] }).children;

describe("Table factory", () => {
  it("is a Column of Rows (one Row per data row)", () => {
    const t = Table({ columns: ["1fr", 80] }, [
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(unwrap(t)).toBeInstanceOf(ContainerElement);
    const rows = rowsOf(t);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toBeInstanceOf(RowElement);
  });

  it("fixed point columns become a fixed-width Box, fractions become Expanded", () => {
    const t = Table({ columns: [120, "2fr"] }, [["x", "y"]]);
    const cells = cellsOf(rowsOf(t)[0]);
    expect(cells[0]).toBeInstanceOf(RectangleElement); // fixed → Box
    expect((cells[0] as RectangleElement).getProps().width).toBe(120);
    expect(cells[1]).toBeInstanceOf(ExpandedElement); // fraction → Expanded
    expect((cells[1] as ExpandedElement).getFlex()).toBe(2);
  });

  it("string cells are wrapped in Text", () => {
    const t = Table({ columns: [100] }, [["hello"]]);
    const box = cellsOf(rowsOf(t)[0])[0] as RectangleElement;
    const inner = unwrap((box.getProps().children as PDFElement[])[0]); // Box > StructGroup(TD) > Text
    expect((inner as { getProps(): { content: unknown } }).getProps().content).toBe("hello");
  });

  it("applies gap / rowGap / colGap", () => {
    const t = Table({ columns: ["1fr", "1fr"], gap: 8, colGap: 4 }, [
      ["a", "b"],
      ["c", "d"],
    ]);
    expect((unwrap(t).getProps() as { gap: number }).gap).toBe(8); // rowGap falls back to gap
    expect((rowsOf(t)[0].getProps() as { gap: number }).gap).toBe(4); // colGap overrides
  });

  it("rejects an unsupported column width", () => {
    expect(() => Table({ columns: ["5px"] }, [["x"]])).toThrow();
  });

  it("an `auto` column defers to a DeferredElement (resolved at layout time)", () => {
    expect(Table({ columns: ["auto", "1fr"] }, [["a", "b"]])).toBeInstanceOf(DeferredElement);
  });

  it("an `auto` table renders to a valid PDF with its content intact", async () => {
    const { renderPdf } = await import("../../../src/lib/api/structure");
    const { Document, Page } = await import("../../../src/lib/api/structure");
    const pdf = await renderPdf(
      Document([
        Page([
          Table({ columns: ["1fr", "auto"] }, [
            ["Beschreibung", "11.06.2026"],
            ["Zeile", "01.01.2026"],
          ]),
        ]),
      ]),
      { compress: false },
    );
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("(11.06.2026)"); // one run, not split across an empty line
  });

  it("missing column spec for an extra cell defaults to 1fr", () => {
    const cells = cellsOf(rowsOf(Table({ columns: [100] }, [["a", "b"]]))[0]);
    expect(cells[1]).toBeInstanceOf(ExpandedElement); // 2nd cell, no column spec → 1fr
  });

  it("a `header` option returns a repeating-header element; without it, a plain Column", () => {
    expect(unwrap(Table({ columns: ["1fr"] }, [["a"]]))).toBeInstanceOf(ContainerElement);
    expect(unwrap(Table({ columns: ["1fr"], header: ["H"] }, [["a"]]))).toBeInstanceOf(
      RepeatingHeaderElement,
    );
  });

  it("`cellBorder` draws the complete grid once: inner cells bottom+right, edges add top/left", () => {
    const rows = rowsOf(
      Table({ columns: ["1fr", 80], cellBorder: "gray" }, [
        ["a", "b"],
        ["c", "d"],
      ]),
    );
    // Top-edge cell (first row, fixed col 1): gets top + bottom + right, but not left.
    const edge = cellsOf(rows[0])[1] as RectangleElement;
    const es = edge.getProps().sideBorders!;
    expect(es.top).toBeDefined();
    expect(es.bottom).toBeDefined();
    expect(es.right).toBeDefined();
    expect(es.left).toBeUndefined();
    // Interior cell (second row, col 1): only bottom + right (no doubling on the outer edge).
    const inner = cellsOf(rows[1])[1] as RectangleElement;
    const is = inner.getProps().sideBorders!;
    expect(is.top).toBeUndefined();
    expect(is.left).toBeUndefined();
    expect(is.bottom).toBeDefined();
    expect(is.right).toBeDefined();
  });
});

// CSS grid's `minmax(min, auto)`: as wide as the widest cell, but never narrower than `min` (points,
// like every jasy number). Measured after layout: where the second column starts.
describe('a "minmax(<points>, auto)" column', () => {
  const textNode = (root: unknown, content: string): TextElement => {
    const seen = new Set<unknown>();
    const walk = (node: unknown): TextElement | undefined => {
      if (!node || typeof node !== "object" || seen.has(node)) return undefined;
      seen.add(node);
      if (node instanceof TextElement && node.getProps().content === content) return node;
      for (const value of Object.values(node as Record<string, unknown>)) {
        for (const kid of Array.isArray(value) ? value : [value]) {
          const hit = walk(kid);
          if (hit) return hit;
        }
      }
      return undefined;
    };
    const hit = walk(root);
    if (!hit) throw new Error(`no text "${content}"`);
    return hit;
  };
  /** Width of the first column: where "next" starts minus where the first cell starts. */
  const firstColumnWidth = async (column: string, first: string): Promise<number> => {
    const doc = Document([Page([Table({ columns: [column, "1fr"] }, [[first, "next"]])])]);
    await renderToBytes(doc);
    return textNode(doc, "next").getProps().x - textNode(doc, first).getProps().x;
  };

  it("holds its minimum when the content is narrower", async () => {
    expect(await firstColumnWidth("minmax(60, auto)", "a")).toBe(60);
  });

  it("grows like `auto` when the content is wider", async () => {
    const wide = "a cell much wider than sixty points";
    expect(await firstColumnWidth("minmax(60, auto)", wide)).toBe(
      await firstColumnWidth("auto", wide),
    );
    expect(await firstColumnWidth("auto", wide)).toBeGreaterThan(60);
  });

  it("measures past a header that is shorter than the columns", async () => {
    // A missing header cell is skipped, as a missing body cell is.
    const doc = Document([
      Page([Table({ columns: ["1fr", "minmax(40, auto)"], header: ["Item"] }, [["a", "b"]])]),
    ]);
    await expect(renderToBytes(doc)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("is resolved at layout time, like `auto`", () => {
    expect(Table({ columns: ["minmax(40, auto)"] }, [["a"]])).toBeInstanceOf(DeferredElement);
  });

  it.each(["minmax(40, 1fr)", "minmax(40, 120)", "minmax(auto, 40)", "minmax(40px, auto)"])(
    "names the edge of what is supported: %s",
    (column) => {
      expect(() => Table({ columns: [column] }, [["a"]])).toThrow(/minmax\(40, auto\)/);
    },
  );
});

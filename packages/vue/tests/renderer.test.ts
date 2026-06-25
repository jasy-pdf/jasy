import { describe, it, expect } from "vitest";
import { h, type Component } from "vue";
import {
  Document,
  Page,
  Text,
  Table,
  TableRow,
  TableCell,
  toDocumentDescriptor,
} from "../src/index.ts";

// A minimal options component from a render function - no SFC compilation needed in the test runner.
const comp = (render: () => any): Component => ({ render });

describe("toDocumentDescriptor (the firewall)", () => {
  it("maps a Document > Page > Text tree onto the descriptor seam", () => {
    const desc = toDocumentDescriptor(
      comp(() =>
        h(Document, null, () => h(Page, { size: "A4" }, () => h(Text, { size: 12 }, () => "Hello"))),
      ),
    );
    expect(desc.type).toBe("document");
    const page = desc.children?.[0] as any;
    expect(page.type).toBe("page");
    expect(page.props.size).toBe("A4");
    const text = page.children[0];
    expect(text.type).toBe("text");
    expect(text.props.size).toBe(12);
    expect(text.children).toEqual(["Hello"]);
  });

  it("forwards typed props; `bold` is true when set, undefined when unset (inherits)", () => {
    const desc = toDocumentDescriptor(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () => [
            h(Text, { bold: true }, () => "B"),
            h(Text, { size: 10 }, () => "plain"),
          ]),
        ),
      ),
    );
    const page = desc.children?.[0] as any;
    const [bold, plain] = page.children;
    expect(bold.props.bold).toBe(true);
    // Unset must stay undefined so the engine inherits the DefaultTextStyle (not a forced false).
    expect(plain.props.bold).toBeUndefined();
  });

  it("builds the Table structure: a header row, then body rows of cells", () => {
    const desc = toDocumentDescriptor(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Table, { columns: ["1fr", 80] }, () => [
              h(TableRow, { header: true }, () => [
                h(TableCell, null, () => "H1"),
                h(TableCell, null, () => "H2"),
              ]),
              h(TableRow, null, () => [
                h(TableCell, null, () => "a"),
                h(TableCell, null, () => "b"),
              ]),
            ]),
          ),
        ),
      ),
    );
    const page = desc.children?.[0] as any;
    const table = page.children[0];
    expect(table.type).toBe("table");
    expect(table.props.columns).toEqual(["1fr", 80]);
    const rows = table.children;
    expect(rows[0].type).toBe("table-row");
    expect(rows[0].props.header).toBe(true);
    expect(rows[0].children[0].type).toBe("table-cell");
    expect(rows[0].children[0].children).toEqual(["H1"]);
    expect(rows[1].props.header).toBe(false);
  });

  it("Page #header / #footer become page-header / page-footer markers; body stays", () => {
    const desc = toDocumentDescriptor(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, {
            header: () => h(Text, null, () => "HDR"),
            footer: () => h(Text, null, () => "FTR"),
            default: () => h(Text, null, () => "BODY"),
          }),
        ),
      ),
    );
    const page = desc.children?.[0] as any;
    const types = page.children.map((c: any) => c.type);
    expect(types).toContain("page-header");
    expect(types).toContain("page-footer");
    const body = page.children.find((c: any) => c.type === "text");
    expect(body.children).toEqual(["BODY"]);
  });

  it("strips Vue's empty #text fragment anchors so a v-for list adds no stray gap children", () => {
    const items = ["a", "b", "c"];
    const desc = toDocumentDescriptor(
      comp(() =>
        h(Document, null, () =>
          h(Page, { gap: 10 }, () => [
            h(Text, null, () => "title"),
            ...items.map((t) => h(Text, null, () => t)),
          ]),
        ),
      ),
    );
    const page = desc.children?.[0] as any;
    // No empty-string anchor children - exactly the title + three items (a stray "" would each add a gap).
    expect(page.children).not.toContain("");
    expect(page.children).toHaveLength(4);
  });

  it("throws if the root does not render a <Document>", () => {
    expect(() => toDocumentDescriptor(comp(() => h(Page, null, () => "x")))).toThrow(/Document/);
  });
});

import { describe, it, expect } from "vitest";
import { h, type Component } from "vue";
import {
  Document,
  Page,
  Text,
  Box,
  Table,
  TableRow,
  TableCell,
  Positioned,
  DefaultTextStyle,
  renderToPdf,
} from "../src/index.ts";

const comp = (render: () => any): Component => ({ render });
const header = (bytes: Uint8Array) => String.fromCharCode(...bytes.slice(0, 5));

describe("renderToPdf (component → PDF bytes, in-process)", () => {
  it("renders a component tree to valid PDF bytes", async () => {
    const bytes = await renderToPdf(
      comp(() =>
        h(Document, null, () =>
          h(Page, { size: "A4" }, () => h(Text, { size: 16, bold: true }, () => "Hi")),
        ),
      ),
    );
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(500);
    expect(header(bytes)).toBe("%PDF-");
  });

  it("renders a table (auto/fr columns + grid) without throwing", async () => {
    const bytes = await renderToPdf(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Table, { columns: ["auto", "1fr"], cellBorder: "#ccc" }, () => [
              h(TableRow, { header: true }, () => [
                h(TableCell, null, () => "Item"),
                h(TableCell, null, () => "Qty"),
              ]),
              h(TableRow, null, () => [
                h(TableCell, null, () => "Pen"),
                h(TableCell, null, () => "3"),
              ]),
            ]),
          ),
        ),
      ),
    );
    expect(header(bytes)).toBe("%PDF-");
  });

  it("renders document-wide font defaults (no custom font) to a PDF", async () => {
    const bytes = await renderToPdf(
      comp(() =>
        h(Document, { size: 13, color: "#222" }, () =>
          h(Page, null, () => h(Text, null, () => "inherits the document defaults")),
        ),
      ),
    );
    expect(header(bytes)).toBe("%PDF-");
  });

  it("renders #header / #footer + a Positioned badge in a relative Box", async () => {
    const bytes = await renderToPdf(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, {
            header: () => h(Text, { bold: true }, () => "Report"),
            footer: () => h(Text, { align: "center" }, () => "footer"),
            default: () =>
              h(Box, { relative: true, padding: 12 }, () => [
                h(Text, null, () => "body"),
                h(Positioned, { top: -6, right: -6 }, () => h(Text, { size: 8 }, () => "NEW")),
              ]),
          }),
        ),
      ),
    );
    expect(header(bytes)).toBe("%PDF-");
  });

  it("renders a DefaultTextStyle subtree", async () => {
    const bytes = await renderToPdf(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(DefaultTextStyle, { size: 18, bold: true }, () => h(Text, null, () => "big bold")),
          ),
        ),
      ),
    );
    expect(header(bytes)).toBe("%PDF-");
  });
});

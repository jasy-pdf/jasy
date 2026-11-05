import { describe, it, expect, vi } from "vitest";
import { h, type Component } from "vue";
import * as pdf from "@jasy/pdf";
import {
  Document,
  Page,
  Row,
  Column,
  Box,
  Text,
  Image,
  Region,
  Flow,
  Expanded,
  renderToPdf,
} from "../src/index.ts";

// The props the components gained to match the engine: the same document in a template and in
// TypeScript must give the same bytes - and Vue must accept every value without an "Invalid prop"
// warning (a `width: "45%"` against a `Number` prop warned, while the value still slipped through).

const comp = (render: () => any): Component => ({ render });
const SIZE = { width: 300, height: 260 };
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>`;

async function same(ts: pdf.PDFElement[], vueContent: () => any) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const a = await pdf.renderToBytes(pdf.Document([pdf.Page({ size: SIZE, margin: 20 }, ts)]));
  const b = await renderToPdf(
    comp(() => h(Document, null, () => h(Page, { size: SIZE, margin: 20 }, vueContent))),
  );
  const warnings = warn.mock.calls.map((c) => String(c[0]));
  warn.mockRestore();
  expect(warnings).toEqual([]);
  expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
}

describe("layout props match the engine", () => {
  it("wrap, % widths, reverse, alignSelf, order, min/max, aspect ratio", async () => {
    await same(
      [
        pdf.Row({ wrap: true, gap: 6 }, [
          pdf.Box({ width: "45%", bg: "#eef" }, [pdf.Text("a")]),
          pdf.Box({ width: "45%", bg: "#efe" }, [pdf.Text("b")]),
          pdf.Box({ width: "45%", bg: "#fee", order: -1 }, [pdf.Text("c")]),
        ]),
        pdf.Row({ reverse: true, height: 40, align: "start" }, [
          pdf.Box({ height: 12, alignSelf: "end", bg: "#ddd" }, [pdf.Text("x")]),
          pdf.Box({ maxWidth: 60, minHeight: 20, bg: "#ccc" }, [pdf.Text("y")]),
        ]),
        pdf.Column({ width: "50%", alignContent: "center" }, [pdf.Text("half")]),
        pdf.Box({ width: 80, aspectRatio: 2, bg: "#abc" }, []),
      ],
      () => [
        h(Row, { wrap: true, gap: 6 }, () => [
          h(Box, { width: "45%", bg: "#eef" }, () => h(Text, null, () => "a")),
          h(Box, { width: "45%", bg: "#efe" }, () => h(Text, null, () => "b")),
          h(Box, { width: "45%", bg: "#fee", order: -1 }, () => h(Text, null, () => "c")),
        ]),
        h(Row, { reverse: true, height: 40, align: "start" }, () => [
          h(Box, { height: 12, alignSelf: "end", bg: "#ddd" }, () => h(Text, null, () => "x")),
          h(Box, { maxWidth: 60, minHeight: 20, bg: "#ccc" }, () => h(Text, null, () => "y")),
        ]),
        h(Column, { width: "50%", alignContent: "center" }, () => h(Text, null, () => "half")),
        h(Box, { width: 80, aspectRatio: 2, bg: "#abc" }),
      ],
    );
  });

  it("a gradient background, per-corner radii, an image alt, a bounded Region", async () => {
    const bg = pdf.linearGradient("#0a2348", "#3b82f6");
    const radius = { topLeft: 12, bottomRight: 12 };
    await same(
      [
        pdf.Box({ height: 30, bg, radius }, []),
        pdf.Image(SVG, { width: 20, alt: "mark" }),
        pdf.Flow({ template: () => pdf.Row([pdf.Expanded(pdf.Region({ maxWidth: 120 }))]) }, [
          pdf.Text("flows"),
        ]),
      ],
      () => [
        h(Box, { height: 30, bg, radius }),
        h(Image, { src: SVG, width: 20, alt: "mark" }),
        h(Flow, null, {
          page: () => h(Row, null, () => h(Expanded, null, () => h(Region, { maxWidth: 120 }))),
          default: () => h(Text, null, () => "flows"),
        }),
      ],
    );
  });
});

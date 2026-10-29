import { describe, it, expect } from "vitest";
import { defineComponent, h, inject, provide, type Component } from "vue";
import * as pdf from "@jasy/pdf";
import {
  Document,
  Page,
  Box,
  Row,
  Expanded,
  Text,
  Flow,
  Region,
  ColumnBreak,
  SplitView,
  renderToPdf,
  toDocumentDescriptor,
} from "../src/index.ts";

// The oracle is the TypeScript API: the same Flow written in a template must give the same bytes.

const comp = (render: () => any): Component => ({ render });
const lines = (n: number, from = 1) =>
  Array.from(
    { length: n },
    (_, i) => `${from + i}. A line of content that flows on through the Regions.`,
  );
const SIZE = { width: 300, height: 260 };

const tsDoc = (content: pdf.PDFElement[]) =>
  pdf.Document([pdf.Page({ size: SIZE, margin: 20 }, content)]);
const vueDoc = (content: () => any) =>
  comp(() => h(Document, null, () => h(Page, { size: SIZE, margin: 20 }, content)));
const same = async (a: Uint8Array, b: Uint8Array) =>
  expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);

describe("<Flow> with a #page slot", () => {
  it("draws what the same Flow in TypeScript draws, page for page", async () => {
    const ts = await pdf.renderToBytes(
      tsDoc([
        pdf.Flow(
          {
            gap: 4,
            template: ({ index }) =>
              pdf.Box({ border: "#1450aa", padding: 6 }, [
                pdf.Text(index === 0 ? "Report" : `Report, page ${index + 1}`, {
                  size: index === 0 ? 14 : 8,
                  bold: true,
                }),
                pdf.Row({ gap: 10 }, [pdf.Expanded(pdf.Region()), pdf.Expanded(pdf.Region())]),
              ]),
          },
          lines(40).map((t) => pdf.Text(t, { size: 8 })),
        ),
        pdf.Text("After the Flow.", { size: 8 }),
      ]),
    );
    const vue = await renderToPdf(
      vueDoc(() => [
        h(
          Flow,
          { gap: 4 },
          {
            page: ({ index }: { index: number }) =>
              h(Box, { border: "#1450aa", padding: 6 }, () => [
                h(Text, { size: index === 0 ? 14 : 8, bold: true }, () =>
                  index === 0 ? "Report" : `Report, page ${index + 1}`,
                ),
                h(Row, { gap: 10 }, () => [
                  h(Expanded, null, () => h(Region)),
                  h(Expanded, null, () => h(Region)),
                ]),
              ]),
            default: () => lines(40).map((t) => h(Text, { size: 8 }, () => t)),
          },
        ),
        h(Text, { size: 8 }, () => "After the Flow."),
      ]),
    );
    expect(new TextDecoder("latin1").decode(vue)).toMatch(/\/Count [3-9]/);
    await same(vue, ts);
  });

  it("renders #page with what the components around it provide", async () => {
    const Brand = defineComponent({
      setup: () => () => h(Text, { size: 9 }, () => inject<string>("brand", "missing")),
    });
    const Provider = defineComponent({
      setup(_, { slots }) {
        provide("brand", "Valley Courier");
        return () => slots.default?.();
      },
    });
    const pages: number[] = [];
    const bytes = await renderToPdf(
      vueDoc(() =>
        h(Provider, null, () =>
          h(Flow, null, {
            page: ({ index }: { index: number }) => {
              pages.push(index);
              return h(Box, null, () => [h(Brand), h(Region)]);
            },
            default: () => lines(30).map((t) => h(Text, { size: 8 }, () => t)),
          }),
        ),
      ),
      undefined,
      { compress: false, kerning: false },
    );
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("(Valley Courier)");
    expect(text).not.toContain("(missing)");
    expect(new Set(pages)).toEqual(new Set([0, 1]));
  });

  it("takes a ColumnBreak, and a SplitView, as the TypeScript API does", async () => {
    const content = (t: (s: string) => any, brk: () => any) => [
      ...lines(6).map(t),
      brk(),
      ...lines(30, 7).map(t),
    ];
    const ts = await pdf.renderToBytes(
      tsDoc([
        pdf.SplitView(
          { columns: 3, colGap: 8, rowGap: 3 },
          content((s) => pdf.Text(s, { size: 7 }), pdf.ColumnBreak),
        ),
        pdf.Text("After.", { size: 8 }),
      ]),
    );
    const vue = await renderToPdf(
      vueDoc(() => [
        h(SplitView, { columns: 3, colGap: 8, rowGap: 3 }, () =>
          content(
            (s) => h(Text, { size: 7 }, () => s),
            () => h(ColumnBreak),
          ),
        ),
        h(Text, { size: 8 }, () => "After."),
      ]),
    );
    await same(vue, ts);
  });

  it("takes a % Region", async () => {
    const ts = await pdf.renderToBytes(
      tsDoc([
        pdf.Flow(
          { template: () => pdf.Region({ height: "50%" }) },
          lines(20).map((t) => pdf.Text(t, { size: 8 })),
        ),
      ]),
    );
    const vue = await renderToPdf(
      vueDoc(() =>
        h(Flow, null, {
          page: () => h(Region, { height: "50%" }),
          default: () => lines(20).map((t) => h(Text, { size: 8 }, () => t)),
        }),
      ),
    );
    await same(vue, ts);
  });
});

describe("<Flow> - what goes wrong says what to do", () => {
  const flow = (slots: Record<string, () => any>) =>
    renderToPdf(vueDoc(() => h(Flow, null, slots)));

  it("no #page", async () => {
    await expect(flow({ default: () => h(Text, null, () => "x") })).rejects.toThrow(
      "@jasy/vue: a <Flow> needs a #page slot with at least one <Region>.",
    );
  });

  it("a Region in the content instead of #page", async () => {
    await expect(
      flow({ page: () => h(Region), default: () => [h(Text, null, () => "x"), h(Region)] }),
    ).rejects.toThrow(/in @jasy\/vue: the #page slot/);
  });

  it("a #page without a Region, or with nothing at all", async () => {
    for (const page of [() => h(Text, null, () => "title"), () => null]) {
      await expect(flow({ page, default: () => h(Text, null, () => "x") })).rejects.toMatchObject({
        name: "FlowWithoutRegionError",
        message: expect.stringContaining("#page"),
      });
    }
  });

  it("a descriptor rendered after the app is gone", async () => {
    const desc = toDocumentDescriptor(
      vueDoc(() =>
        h(Flow, null, { page: () => h(Region), default: () => h(Text, null, () => "x") }),
      ),
    );
    await expect(pdf.renderToBytes(pdf.buildDocument(desc))).rejects.toThrow(
      /render the document with renderToPdf/,
    );
  });
});

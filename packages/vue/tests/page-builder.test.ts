import { describe, it, expect } from "vitest";
import { h, inject, provide, type Component } from "vue";
import * as pdf from "@jasy/pdf";
import {
  Document,
  Page,
  Row,
  Column,
  Text,
  Flow,
  Region,
  PageBuilder,
  SubPageNumber,
  SubPageCount,
  renderToPdf,
} from "../src/index.ts";

// The oracle is the TypeScript API: the same document written in a template must give the same bytes.

const comp = (render: () => any): Component => ({ render });
const SIZE = { width: 300, height: 260 };
const page = { size: SIZE, margin: 20 };
const body = (n: number) => Array.from({ length: n }, (_, i) => `Line ${i + 1} of the body.`);
async function same(ts: pdf.JasyDocument, vue: Component) {
  const a = await pdf.renderToBytes(ts);
  const b = await renderToPdf(vue);
  expect(Buffer.from(b).equals(Buffer.from(a))).toBe(true);
}

describe("<PageBuilder #default='{ pageNumber, pageCount }'>", () => {
  it("builds each page's footer like the TypeScript PageBuilder", async () => {
    await same(
      pdf.Document([
        pdf.Page(
          {
            ...page,
            footer: pdf.PageBuilder(({ pageNumber, pageCount }) =>
              pdf.Text(`Page ${pageNumber} of ${pageCount}`, { size: 8 }),
            ),
          },
          body(40).map((l) => pdf.Text(l)),
        ),
      ]),
      comp(() =>
        h(Document, null, () =>
          h(Page, page, {
            footer: () =>
              h(PageBuilder, null, {
                default: ({ pageNumber, pageCount }: pdf.PageInfo) =>
                  h(Text, { size: 8 }, () => `Page ${pageNumber} of ${pageCount}`),
              }),
            default: () => body(40).map((l) => h(Text, null, () => l)),
          }),
        ),
      ),
    );
  });

  it("builds nothing where the slot renders nothing, and sees what is provided around it", async () => {
    const Continued = {
      setup() {
        const color = inject<string>("accent");
        return () => h(Text, { color }, () => "continued");
      },
    };
    await same(
      pdf.Document([
        pdf.Page(
          {
            ...page,
            header: pdf.PageBuilder(({ pageNumber }) =>
              pageNumber === 1 ? pdf.Column([]) : pdf.Text("continued", { color: "#1450aa" }),
            ),
          },
          body(40).map((l) => pdf.Text(l)),
        ),
      ]),
      {
        setup() {
          provide("accent", "#1450aa");
          return () =>
            h(Document, null, () =>
              h(Page, page, {
                header: () =>
                  h(PageBuilder, null, {
                    default: ({ pageNumber }: pdf.PageInfo) =>
                      pageNumber === 1 ? null : h(Continued),
                  }),
                default: () => body(40).map((l) => h(Text, null, () => l)),
              }),
            );
        },
      },
    );
  });

  it("counts within each Page with SubPageNumber and SubPageCount", async () => {
    const tsFooter = pdf.Row([
      pdf.SubPageNumber({ size: 8 }),
      pdf.Text("/"),
      pdf.SubPageCount({ size: 8 }),
    ]);
    const vueFooter = () =>
      h(Row, null, () => [
        h(SubPageNumber, { size: 8 }),
        h(Text, null, () => "/"),
        h(SubPageCount, { size: 8 }),
      ]);
    await same(
      pdf.Document([
        pdf.Page(
          { ...page, footer: tsFooter },
          body(30).map((l) => pdf.Text(l)),
        ),
        pdf.Page(
          { ...page, footer: tsFooter },
          body(10).map((l) => pdf.Text(l)),
        ),
      ]),
      comp(() =>
        h(Document, null, () => [
          h(Page, page, {
            footer: vueFooter,
            default: () => body(30).map((l) => h(Text, null, () => l)),
          }),
          h(Page, page, {
            footer: vueFooter,
            default: () => body(10).map((l) => h(Text, null, () => l)),
          }),
        ]),
      ),
    );
  });

  it("inside a Flow's #page, draws what that page rendered", async () => {
    await same(
      pdf.Document([
        pdf.Page(page, [
          pdf.Flow(
            {
              template: ({ index }) =>
                pdf.Column({ gap: 4 }, [
                  pdf.PageBuilder(({ pageNumber }) =>
                    pdf.Text(`part ${index + 1}, sheet ${pageNumber}`),
                  ),
                  pdf.Region(),
                ]),
            },
            body(40).map((l) => pdf.Text(l)),
          ),
        ]),
      ]),
      comp(() =>
        h(Document, null, () =>
          h(Page, page, () =>
            h(Flow, null, {
              page: ({ index }: pdf.FlowPage) =>
                h(Column, { gap: 4 }, () => [
                  h(PageBuilder, null, {
                    default: ({ pageNumber }: pdf.PageInfo) =>
                      h(Text, null, () => `part ${index + 1}, sheet ${pageNumber}`),
                  }),
                  h(Region),
                ]),
              default: () => body(40).map((l) => h(Text, null, () => l)),
            }),
          ),
        ),
      ),
    );
  });
});

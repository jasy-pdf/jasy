import { describe, it, expect } from "vitest";
import { h, type Component } from "vue";
import {
  Document,
  Page,
  Column,
  Box,
  Text,
  PageBreak,
  KeepTogether,
  renderToPdfString,
} from "../src/index.ts";

// Page-break control as Vue components/props: PageBreak, the breakBefore/breakAfter/keepTogether props,
// and the standalone <KeepTogether>. These assert the WIRING reaches the engine; the veto/degrade logic
// itself is covered by the core suite.

const comp = (render: () => any): Component => ({ render });
// `kerning: false` too, not just `compress: false`: with kerning on (the default) a word can be split
// into a `TJ` array (e.g. "BODY" -> `[(BOD) .. (Y)]`), so `(BODY)` is no longer a contiguous substring.
const render = (c: Component) =>
  renderToPdfString(c, undefined, { compress: false, kerning: false });
const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

describe("page-break control as Vue components", () => {
  it("<PageBreak> forces everything after it onto a new page", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Column, null, () => [
              h(Text, null, () => "AAA"),
              h(PageBreak, null),
              h(Text, null, () => "BBB"),
            ]),
          ),
        ),
      ),
    );
    expect(pageCount(pdf)).toBe(2);
    expect(pdf).toContain("(AAA)");
    expect(pdf).toContain("(BBB)");
  });

  it("`breakBefore` on <Box> starts it on a fresh page", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Column, null, () => [
              h(Text, null, () => "AAA"),
              h(Box, { breakBefore: true }, () => h(Text, null, () => "BBB")),
            ]),
          ),
        ),
      ),
    );
    expect(pageCount(pdf)).toBe(2);
  });

  it("`breakAfter` on <Box> starts the next content on a fresh page", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Column, null, () => [
              h(Box, { breakAfter: true }, () => h(Text, null, () => "AAA")),
              h(Text, null, () => "BBB"),
            ]),
          ),
        ),
      ),
    );
    expect(pageCount(pdf)).toBe(2);
  });

  it("<KeepTogether> is transparent and renders its children", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(KeepTogether, null, () => [
              h(Text, null, () => "TITLE"),
              h(Text, null, () => "BODY"),
            ]),
          ),
        ),
      ),
    );
    expect(pageCount(pdf)).toBe(1);
    expect(pdf).toContain("(TITLE)");
    expect(pdf).toContain("(BODY)");
  });

  it("`keepTogether` prop on <Box> renders its children", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () => h(Box, { keepTogether: true }, () => h(Text, null, () => "CARD"))),
        ),
      ),
    );
    expect(pdf).toContain("(CARD)");
  });
});

import { describe, it, expect } from "vitest";
import { h, type Component } from "vue";
import {
  Document,
  Page,
  Column,
  Text,
  Paragraph,
  Span,
  Box,
  Link,
  Anchor,
  Bookmark,
  Rotated,
  RotatedBox,
  PageNumber,
  PageCount,
  renderToPdfString,
} from "../src/index.ts";

const comp = (render: () => any): Component => ({ render });
const count = (s: string, needle: string) => s.split(needle).length - 1;

// `compress: false` keeps the content stream greppable so we can assert on what was actually drawn.
const render = (c: Component) => renderToPdfString(c, undefined, { compress: false });

describe("navigation, transforms and page numbers as Vue components", () => {
  it("turns <Link href> into an external /Link annotation", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Link, { href: "https://jasy.dev" }, () => h(Text, null, () => "go")),
          ),
        ),
      ),
    );
    expect(pdf).toContain("/Subtype /Link");
    expect(pdf).toContain("/A << /S /URI /URI (https://jasy.dev) >>");
  });

  it("wires <Link to> to <Anchor name> through a named destination", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () => [
          h(Page, null, () => h(Link, { to: "sec" }, () => h(Text, null, () => "jump"))),
          h(Page, null, () => h(Anchor, { name: "sec" }, () => h(Text, null, () => "Section"))),
        ]),
      ),
    );
    expect(pdf).toContain("/S /GoTo /D (sec)");
    expect(pdf).toContain("/Dests << /Names [ (sec) [");
  });

  it("puts a link on a single <Span> without linking the rest of the line", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Paragraph, null, () => [
              h(Span, null, () => "visit "),
              h(Span, { href: "https://jasy.dev" }, () => "jasy.dev"),
              h(Span, null, () => " now"),
            ]),
          ),
        ),
      ),
    );
    expect(count(pdf, "/Subtype /Link")).toBe(1);
    expect(pdf).toContain("/URI (https://jasy.dev)");
  });

  it("builds a nested outline from <Bookmark>", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Column, null, () => [
              h(Bookmark, { title: "Chapter", level: 1 }, () => h(Text, null, () => "Chapter")),
              h(Bookmark, { title: "Section", level: 2 }, () => h(Text, null, () => "Section")),
            ]),
          ),
        ),
      ),
    );
    expect(pdf).toContain("/Type /Outlines");
    expect(pdf).toContain("/Title (Chapter)");
    expect(pdf).toContain("/Title (Section)");
  });

  it("rotates with <Rotated> and <RotatedBox>", async () => {
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Column, null, () => [
              h(Rotated, { angle: 20 }, () =>
                h(Box, { bg: "#eeeeee" }, () => h(Text, null, () => "stamp")),
              ),
              h(RotatedBox, { turns: 3 }, () => h(Text, null, () => "label")),
            ]),
          ),
        ),
      ),
    );
    expect(count(pdf, " cm")).toBeGreaterThanOrEqual(2); // one transform matrix per rotation
    expect(pdf).toContain("(stamp)");
    expect(pdf).toContain("(label)");
  });

  it("prints the running page number and the document total", async () => {
    const filler = () =>
      Array.from({ length: 14 }, () => h(Paragraph, null, () => "x ".repeat(300)));
    const pdf = await render(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, {
            footer: () => [h(Text, null, () => "p"), h(PageNumber, null), h(PageCount, null)],
            default: () => h(Column, null, filler),
          }),
        ),
      ),
    );
    expect(pdf).toContain("/Count 2"); // the body flowed onto a second physical page
    // Page 1 prints "1" then the total "2"; page 2 prints "2" twice. So both digits must be drawn.
    const digits = [...pdf.matchAll(/\((\d+)\) Tj/g)].map((m) => m[1]);
    expect(digits).toEqual(["1", "2", "2", "2"]);
  });

  it("applies `offset` so a cover page does not count", async () => {
    const pdf = await render(
      comp(() => h(Document, null, () => h(Page, null, () => h(PageNumber, { offset: -1 })))),
    );
    expect(pdf).toContain("(0)"); // 1 + (-1)
  });
});

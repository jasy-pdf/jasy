import { describe, it, expect } from "vitest";
import { Document, Page, Box, Text, span, Link, renderPdf } from "../../../src/lib/api";

// Count non-overlapping occurrences of a needle.
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("hyperlinks (/Link annotations)", () => {
  it("adds no annotations to a page without links", async () => {
    const pdf = await renderPdf(Document([Page([Text("plain text")])]));
    expect(pdf).not.toContain("/Subtype /Link");
    expect(pdf).not.toContain("/Annots");
  });

  it("makes a block child a /Link annotation with a URI action", async () => {
    const doc = Document([
      Page([Link({ href: "https://jasy.dev" }, Box({ bg: "#eee" }, [Text("click")]))]),
    ]);
    const pdf = await renderPdf(doc);
    expect(pdf).toContain("/Subtype /Link");
    expect(pdf).toContain("/A << /S /URI /URI (https://jasy.dev) >>");
    expect(pdf).toContain("/Border [0 0 0]"); // no visible annotation border
    expect(pdf).toContain("/Annots ["); // wired onto the page
    expect(count(pdf, "/Subtype /Link")).toBe(1);
  });

  it("makes an href span an inline link over just that run", async () => {
    const doc = Document([
      Page([Text([span("visit "), span("jasy.dev", { href: "https://jasy.dev" }), span(" now")])]),
    ]);
    const pdf = await renderPdf(doc);
    expect(count(pdf, "/Subtype /Link")).toBe(1);
    expect(pdf).toContain("/URI (https://jasy.dev)");
  });

  it("gives a plain-string Text with href a single whole-text link", async () => {
    const doc = Document([Page([Text("jasy.dev", { href: "https://jasy.dev" })])]);
    const pdf = await renderPdf(doc);
    expect(count(pdf, "/Subtype /Link")).toBe(1);
    expect(pdf).toContain("/URI (https://jasy.dev)");
  });

  it("emits one rect per line when a link span wraps across lines", async () => {
    // A narrow box forces the long link text to wrap onto two lines -> two annotation rects.
    const long = "https://github.com/jasy-pdf/jasy/blob/main/README.md";
    const doc = Document([
      Page([Box({ width: 120 }, [Text([span("go to "), span(long, { href: "https://x.dev" })])])]),
    ]);
    const pdf = await renderPdf(doc);
    expect(count(pdf, "/Subtype /Link")).toBeGreaterThanOrEqual(2);
  });

  it("escapes parentheses/backslashes in a URL", async () => {
    const doc = Document([Page([Link({ href: "https://x.dev/a(b)\\c" }, Text("x"))])]);
    const pdf = await renderPdf(doc);
    expect(pdf).toContain("(https://x.dev/a\\(b\\)\\\\c)");
  });
});

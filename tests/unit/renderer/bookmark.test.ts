import { describe, it, expect } from "vitest";
import { Document, Page, Column, Text, Bookmark, renderPdf } from "../../../src/lib/api";

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("document outline (bookmarks)", () => {
  it("adds no /Outlines to a document without bookmarks", async () => {
    const pdf = await renderPdf(Document([Page([Text("plain")])]));
    expect(pdf).not.toContain("/Type /Outlines");
    expect(pdf).not.toContain("/Dest");
  });

  it("emits an outline dict + one item per bookmark, wired to the catalog", async () => {
    const doc = Document([
      Page([
        Column([
          Bookmark({ title: "Intro" }, Text("Intro")),
          Bookmark({ title: "Body" }, Text("Body")),
        ]),
      ]),
    ]);
    const pdf = await renderPdf(doc);
    expect(pdf).toContain("/Type /Outlines");
    expect(pdf).toContain("/Outlines "); // catalog reference
    expect(pdf).toContain("/Title (Intro)");
    expect(pdf).toContain("/Title (Body)");
    expect(count(pdf, "/Dest [")).toBe(2);
    // Two top-level siblings: the root spans both, they cross-link via Prev/Next.
    expect(pdf).toContain("/Count 2");
    expect(pdf).toContain("/Prev ");
    expect(pdf).toContain("/Next ");
  });

  it("nests a level-2 bookmark under the preceding level-1 (a /First child + /Count)", async () => {
    const doc = Document([
      Page([
        Column([
          Bookmark({ title: "Chapter", level: 1 }, Text("Chapter")),
          Bookmark({ title: "Section", level: 2 }, Text("Section")),
        ]),
      ]),
    ]);
    const pdf = await renderPdf(doc);
    // The chapter is the only root; it has one child (the section).
    expect(pdf).toContain("/Type /Outlines /First");
    expect(pdf).toContain("/First "); // chapter -> section
    expect(pdf).toMatch(/\/Title \(Chapter\)[^>]*\/First/);
  });

  it("points each bookmark's /Dest at the page object it lives on", async () => {
    const doc = Document([
      Page([Bookmark({ title: "One" }, Text("one"))]),
      Page([Bookmark({ title: "Two" }, Text("two"))]),
    ]);
    const pdf = await renderPdf(doc);
    const dests = [...pdf.matchAll(/\/Dest \[(\d+) 0 R \/XYZ null [\d.]+ null\]/g)].map(
      (m) => m[1],
    );
    expect(dests).toHaveLength(2);
    expect(dests[0]).not.toBe(dests[1]); // different pages
  });

  it("escapes parentheses in a bookmark title", async () => {
    const doc = Document([Page([Bookmark({ title: "A (test)" }, Text("x"))])]);
    const pdf = await renderPdf(doc);
    expect(pdf).toContain("/Title (A \\(test\\))");
  });
});

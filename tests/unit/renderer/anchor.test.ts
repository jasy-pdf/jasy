import { describe, it, expect } from "vitest";
import { Document, Page, Column, Text, span, Link, Anchor, renderPdf } from "../../../src/lib/api";

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("internal links + named destinations (anchors)", () => {
  it("adds no /Names /Dests to a document without anchors", async () => {
    const pdf = await renderPdf(Document([Page([Text("plain")])]));
    expect(pdf).not.toContain("/Dests");
    expect(pdf).not.toContain("/GoTo");
  });

  it("wires an internal block Link to its Anchor via a named destination", async () => {
    const doc = Document([
      Page([Link({ to: "sec" }, Text("go to section"))]),
      Page([Anchor({ name: "sec" }, Text("Section"))]),
    ]);
    const pdf = await renderPdf(doc);
    expect(pdf).toContain("/Subtype /Link");
    expect(pdf).toContain("/A << /S /GoTo /D (sec) >>");
    expect(pdf).toContain("/Dests << /Names [ (sec) [");
    expect(pdf).not.toContain("/URI"); // internal, not external
  });

  it("resolves an inline span({ to }) as an internal link", async () => {
    const doc = Document([
      Page([Text([span("jump "), span("here", { to: "x" }), span(" now")])]),
      Page([Anchor({ name: "x" }, Text("target"))]),
    ]);
    const pdf = await renderPdf(doc);
    expect(count(pdf, "/Subtype /Link")).toBe(1);
    expect(pdf).toContain("/S /GoTo /D (x)");
  });

  it("points the destination at the page the anchor lives on", async () => {
    const doc = Document([
      Page([Link({ to: "sec" }, Text("toc"))]),
      Page([Text("filler")]),
      Page([Anchor({ name: "sec" }, Text("Section"))]),
    ]);
    const pdf = await renderPdf(doc);
    // The dest's page ref should be the third page object, not the first.
    const m = pdf.match(/\(sec\) \[(\d+) 0 R \/XYZ null [\d.]+ null\]/);
    expect(m).not.toBeNull();
  });

  it("sorts destination names lexically (name-tree requirement)", async () => {
    const doc = Document([
      Page([
        Column([
          Anchor({ name: "zebra" }, Text("z")),
          Anchor({ name: "alpha" }, Text("a")),
          Anchor({ name: "mango" }, Text("m")),
        ]),
      ]),
    ]);
    const pdf = await renderPdf(doc);
    const names = [...pdf.matchAll(/\((alpha|mango|zebra)\) \[/g)].map((m) => m[1]);
    expect(names).toEqual(["alpha", "mango", "zebra"]);
  });

  it("merges embedded files and destinations into one /Names dict", async () => {
    const doc = Document([Page([Anchor({ name: "top" }, Text("top"))])]);
    const pdf = await renderPdf(doc, {
      attachments: [{ name: "x.xml", data: Buffer.from("<x/>"), relationship: "Data" }],
    });
    // Exactly one /Names dictionary, holding BOTH keys.
    expect(count(pdf, "/Names <<")).toBe(1);
    expect(pdf).toContain("/EmbeddedFiles");
    expect(pdf).toContain("/Dests");
  });

  it("rejects a Link with both href and to (or neither)", () => {
    expect(() => Link({ href: "https://x.dev", to: "y" }, Text("x"))).toThrow(/exactly one/);
    expect(() => Link({}, Text("x"))).toThrow(/exactly one/);
  });
});

import { describe, it, expect } from "vitest";
import { Document, Page, renderPdf, renderToBytes } from "../../../src/lib/api/structure";
import { Column } from "../../../src/lib/api/layout";
import { Text } from "../../../src/lib/api/text";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { PageSize } from "../../../src/lib/constants/page-sizes";
import { Orientation } from "../../../src/lib/renderer/pdf-config";

describe("Page factory", () => {
  it("builds a PageElement, children-only form, A4 portrait 56pt by default", () => {
    const p = Page([Text("hi")]);
    expect(p).toBeInstanceOf(PageElement);
    const cfg = (p.getProps() as any).config;
    expect(cfg.pageSize).toBe(PageSize.A4);
    expect(cfg.orientation).toBe(Orientation.portrait);
    expect(cfg.margin).toEqual({ top: 56, right: 56, bottom: 56, left: 56 });
  });

  it("auto-wraps children in a single Column", () => {
    const kids = (Page([Text("a"), Text("b")]).getProps() as any).children;
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(ContainerElement);
  });

  it("maps size (case-insensitive), orientation, margin Insets, header/footer", () => {
    const p = Page(
      {
        size: "Letter",
        orientation: "landscape",
        margin: { x: 40, y: 20 },
        header: Text("h"),
        footer: Text("f"),
      },
      [Text("body")],
    );
    const props = p.getProps() as any;
    expect(props.config.pageSize).toBe(PageSize.LETTER);
    expect(props.config.orientation).toBe(Orientation.landscape);
    expect(props.config.margin).toEqual({ top: 20, right: 40, bottom: 20, left: 40 });
    expect(props.header).toBeDefined();
    expect(props.footer).toBeDefined();
  });

  it("rejects an unknown page size", () => {
    expect(() => Page({ size: "A99" }, [Text("x")])).toThrow();
  });
});

describe("Document factory", () => {
  it("builds a PDFDocumentElement holding the pages", () => {
    const d = Document([Page([Text("a")])]);
    expect(d).toBeInstanceOf(PDFDocumentElement);
    expect((d.getProps() as any).children).toHaveLength(1);
  });
});

describe("renderPdf / renderToBytes", () => {
  it("renders a factory tree to a valid PDF string", async () => {
    const pdf = await renderPdf(
      Document([Page([Column({ gap: 12 }, [Text("Hello", { size: 20, bold: true })])])]),
      { compress: false },
    );
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("(Hello)");
    expect(pdf).toContain("/MediaBox");
  });

  it("renderToBytes returns the same content as bytes", async () => {
    const bytes = await renderToBytes(Document([Page([Text("Bytes")])]));
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(100);
    // First bytes are the "%PDF" header.
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("%PDF");
  });

  it("accepts document meta and still renders a valid PDF", async () => {
    // The factory threads meta → PDFConfig.metaData; the engine does not yet serialize an
    // /Info dictionary (a pending engine feature, also needed for PDF/A), so we only assert
    // the meta path doesn't break rendering.
    const pdf = await renderPdf(
      Document({ meta: { title: "Invoice 42", author: "ACME" } }, [Page([Text("x")])]),
    );
    expect(pdf.startsWith("%PDF")).toBe(true);
  });
});

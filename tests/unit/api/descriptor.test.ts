import { describe, it, expect } from "vitest";
import { build, buildDocument, registerElement, Descriptor } from "../../../src/lib/api/descriptor";
import { renderPdf } from "../../../src/lib/api/structure";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { RowElement } from "../../../src/lib/elements/row-element";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { TextElement } from "../../../src/lib/elements/text-element";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";

describe("build - descriptor node → engine element via the shared factories", () => {
  it("maps the core types to their engine elements", () => {
    expect(build({ type: "column", children: [] })).toBeInstanceOf(ContainerElement);
    expect(build({ type: "row", children: [] })).toBeInstanceOf(RowElement);
    expect(build({ type: "box", children: [] })).toBeInstanceOf(RectangleElement);
    expect(build({ type: "text", children: ["hi"] })).toBeInstanceOf(TextElement);
  });

  it("a bare string child becomes a Text element", () => {
    expect(build("hello")).toBeInstanceOf(TextElement);
  });

  it("passes props through to the factory (column gap/cross)", () => {
    const c = build({ type: "column", props: { gap: 12, cross: "center" }, children: [] });
    const p = (c as ContainerElement).getProps();
    expect(p.gap).toBe(12);
    expect(p.cross).toBe("center");
  });

  it("text content: plain string and mixed spans", () => {
    const plain = build({ type: "text", children: ["plain"] }) as TextElement;
    expect(plain.getProps().content).toBe("plain");

    const mixed = build({
      type: "text",
      children: ["a ", { type: "span", props: { bold: true }, children: ["b"] }],
    }) as TextElement;
    const content = mixed.getProps().content;
    expect(Array.isArray(content)).toBe(true);
  });

  it("throws on an unknown type", () => {
    expect(() => build({ type: "wat", children: [] })).toThrow();
  });
});

describe("registerElement - custom component types", () => {
  it("lets a custom tag resolve through the same seam", () => {
    // A user/binding component: a 'badge' = a small filled Box.
    registerElement("badge", (props, children) =>
      build({ type: "box", props: { bg: props.color ?? "gray", padding: 6, radius: 4 }, children }),
    );
    const el = build({ type: "badge", props: { color: "steelblue" }, children: ["NEW"] });
    expect(el).toBeInstanceOf(RectangleElement);
  });
});

describe("buildDocument + render - a descriptor tree renders a PDF", () => {
  const tree: Descriptor = {
    type: "document",
    children: [
      {
        type: "page",
        props: { size: "A4", margin: 56 },
        children: [
          {
            type: "column",
            props: { gap: 12 },
            children: [
              {
                type: "text",
                props: { size: 24, bold: true },
                children: ["From a descriptor tree"],
              },
              { type: "divider" },
              {
                type: "row",
                props: { main: "between" },
                children: [
                  { type: "text", children: ["left"] },
                  { type: "text", children: ["right"] },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  it("builds a document root", () => {
    expect(buildDocument(tree)).toBeInstanceOf(PDFDocumentElement);
  });

  it("renders to a valid PDF with the content", async () => {
    const pdf = await renderPdf(buildDocument(tree));
    expect(pdf.startsWith("%PDF")).toBe(true);
    expect(pdf).toContain("(From a descriptor tree)");
    expect(pdf).toContain("(left)");
    expect(pdf).toContain("(right)");
  });
});

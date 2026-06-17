import { describe, it, expect } from "vitest";
import { Text, Paragraph, span } from "../../../src/lib/api/text";
import { TextElement, TextSegment } from "../../../src/lib/elements/text-element";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager";

const props = (t: TextElement) => t.getProps();

describe("Text factory", () => {
  it("builds a TextElement with a sensible default size", () => {
    const t = Text("hello");
    expect(t).toBeInstanceOf(TextElement);
    expect(props(t).content).toBe("hello");
    expect(props(t).fontSize).toBe(12);
    expect(props(t).fontStyle).toBe(FontStyle.Normal);
  });

  it("combines bold + italic into one FontStyle", () => {
    expect(props(Text("a", { bold: true })).fontStyle).toBe(FontStyle.Bold);
    expect(props(Text("a", { italic: true })).fontStyle).toBe(FontStyle.Italic);
    expect(props(Text("a", { bold: true, italic: true })).fontStyle).toBe(FontStyle.BoldItalic);
  });

  it("normalizes color via toColor and maps align", () => {
    const t = Text("a", { size: 20, font: "Times-Roman", color: "steelblue", align: "center" });
    expect(props(t).fontSize).toBe(20);
    expect(props(t).fontFamily).toBe("Times-Roman");
    expect(props(t).color.toArray()).toEqual([70, 130, 180]);
    expect(props(t).textAlignment).toBe(HorizontalAlignment.center);
  });

  it("accepts a list of spans as mixed content", () => {
    const t = Text([span("bold ", { bold: true }), span("plain")]);
    const content = props(t).content as TextSegment[];
    expect(Array.isArray(content)).toBe(true);
    expect(content[0].content).toBe("bold ");
    expect(content[0].fontStyle).toBe(FontStyle.Bold);
  });
});

describe("span", () => {
  it("maps style fields, leaving omitted ones undefined to inherit", () => {
    const s = span("hi", { size: 9, color: "#ff0000", italic: true });
    expect(s.content).toBe("hi");
    expect(s.fontSize).toBe(9);
    expect(s.fontColor!.toArray()).toEqual([255, 0, 0]);
    expect(s.fontStyle).toBe(FontStyle.Italic);
    expect(s.fontFamily).toBeUndefined(); // inherits the enclosing Text's font
  });

  it("leaves fontStyle undefined when neither bold nor italic is set", () => {
    expect(span("hi").fontStyle).toBeUndefined();
  });
});

describe("Paragraph", () => {
  it("is Text with the same options", () => {
    const p = Paragraph("body", { font: "Times-Roman" });
    expect(p).toBeInstanceOf(TextElement);
    expect(props(p).fontFamily).toBe("Times-Roman");
    expect(props(p).content).toBe("body");
  });
});

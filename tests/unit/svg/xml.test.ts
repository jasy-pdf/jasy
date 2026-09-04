import { describe, it, expect } from "vitest";
import { parseXml, type XmlElement } from "../../../src/lib/svg/xml.ts";
import { svgToIr } from "../../../src/lib/svg/index.ts";
import type { Path } from "../../../src/lib/ir/display-list.ts";

// Written because `svg-parser` COERCES an attribute that looks numeric: `id="58310095e0"` came back
// as the number 58310095, `id="1e999"` as Infinity. That is unrecoverable on our side and it breaks
// exactly what an id is for - resolving a `url(#id)` reference. An XML attribute is a string.

const first = (source: string): XmlElement => parseXml(source)[0]!;

describe("attributes stay strings", () => {
  it("keeps an id that looks like a number in exponent form", () => {
    // The real case: a Ghostscript/Illustrator export whose clip reference was silently corrupted.
    expect(first(`<svg id="58310095e0"/>`).attributes["id"]).toBe("58310095e0");
    expect(first(`<svg id="1e999"/>`).attributes["id"]).toBe("1e999");
    expect(first(`<svg id="0255367578"/>`).attributes["id"]).toBe("0255367578");
  });

  it("resolves a clip whose id would have been mangled", () => {
    const svg =
      `<svg viewBox="0 0 20 20">` +
      `<defs><clipPath id="12e3"><rect width="10" height="20"/></clipPath></defs>` +
      `<rect clip-path="url(#12e3)" width="20" height="20"/></svg>`;
    const nodes = svgToIr(svg, { x: 0, y: 0, width: 20, height: 20 });
    expect(nodes.some((n) => n.type === "clip-path-push")).toBe(true);
  });
});

describe("the reader", () => {
  it("reads nesting, self-closing tags and both quote styles", () => {
    const root = first(`<svg a="1"><g b='2'><rect/></g></svg>`);
    expect(root.tagName).toBe("svg");
    const g = root.children[0] as XmlElement;
    expect(g.attributes["b"]).toBe("2");
    expect((g.children[0] as XmlElement).tagName).toBe("rect");
  });

  it("keeps the case of a tag, which clipPath and linearGradient need", () => {
    expect(first(`<svg><clipPath/></svg>`).children[0]).toMatchObject({ tagName: "clipPath" });
  });

  it("skips the XML declaration, a doctype and comments", () => {
    const source = `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">
      <!-- a comment with <tags> in it --><svg id="a"/>`;
    expect(first(source).attributes["id"]).toBe("a");
  });

  it("survives a doctype with an internal subset, whose brackets contain '>'", () => {
    expect(first(`<!DOCTYPE svg [ <!ENTITY x "y"> ]><svg id="a"/>`).attributes["id"]).toBe("a");
  });

  it("keeps <style> text, CDATA wrapped or not", () => {
    const plain = first(`<svg><style>.a{fill:red}</style></svg>`);
    expect((plain.children[0] as XmlElement).children[0]).toEqual({
      type: "text",
      value: ".a{fill:red}",
    });
    const cdata = first(`<svg><style><![CDATA[.a{fill:red}]]></style></svg>`);
    expect((cdata.children[0] as XmlElement).children[0]).toEqual({
      type: "text",
      value: ".a{fill:red}",
    });
  });

  it("decodes the predefined entities and numeric references", () => {
    expect(first(`<svg t="a &amp; b &#65; &#x42;"/>`).attributes["t"]).toBe("a & b A B");
  });

  it("recovers from a stray closing tag instead of failing the file", () => {
    // Real exports contain them and browsers recover; a logo that draws beats a purist error.
    const root = first(`<svg><g><rect/></span></g></svg>`);
    expect((root.children[0] as XmlElement).children).toHaveLength(1);
  });

  it("says so when there is no XML at all", () => {
    expect(() => parseXml("just words")).toThrow(/no XML elements/);
  });
});

describe("clipPath", () => {
  const clipped = (body: string) =>
    svgToIr(`<svg viewBox="0 0 20 20">${body}</svg>`, { x: 0, y: 0, width: 20, height: 20 });

  it("pushes and pops a path clip around the element", () => {
    const nodes = clipped(
      `<defs><clipPath id="c"><circle cx="10" cy="10" r="5"/></clipPath></defs>` +
        `<rect clip-path="url(#c)" width="20" height="20"/>`,
    );
    const kinds = nodes.map((n) => n.type);
    expect(kinds).toContain("clip-path-push");
    expect(kinds.indexOf("clip-path-push")).toBeLessThan(kinds.indexOf("path"));
    expect(kinds.lastIndexOf("clip-pop")).toBeGreaterThan(kinds.indexOf("path"));
  });

  it("bakes a clip child's own transform into the coordinates", () => {
    // A clip is set from a path in the CURRENT space, so there is no graphics state to put it in.
    const nodes = clipped(
      `<clipPath id="c"><rect transform="translate(5 0)" width="4" height="4"/></clipPath>` +
        `<rect clip-path="url(#c)" width="20" height="20"/>`,
    );
    const push = nodes.find((n) => n.type === "clip-path-push") as { commands: { x: number }[] };
    expect(push.commands[0]!.x).toBe(5);
  });

  it("unions several children, which is what SVG means by them", () => {
    const nodes = clipped(
      `<clipPath id="c"><rect width="4" height="4"/><rect x="9" width="4" height="4"/></clipPath>` +
        `<rect clip-path="url(#c)" width="20" height="20"/>`,
    );
    const push = nodes.find((n) => n.type === "clip-path-push") as { commands: unknown[] };
    expect(push.commands.length).toBe(10);
  });

  it("carries clip-rule through as the winding rule", () => {
    const nodes = clipped(
      `<clipPath id="c"><path clip-rule="evenodd" d="M0 0h9v9z"/></clipPath>` +
        `<rect clip-path="url(#c)" width="20" height="20"/>`,
    );
    expect(nodes.find((n) => n.type === "clip-path-push")).toMatchObject({ fillRule: "evenodd" });
  });

  it("draws the clipPath's own children as ink under no circumstances", () => {
    const paths = clipped(`<clipPath id="c"><rect width="4" height="4"/></clipPath>`).filter(
      (n): n is Path => n.type === "path",
    );
    expect(paths).toHaveLength(0);
  });

  it("refuses a broken reference, which SVG says makes the element invalid", () => {
    expect(() => clipped(`<rect clip-path="url(#missing)" width="9" height="9"/>`)).toThrow(
      /no <clipPath id="missing">/,
    );
  });

  it("ignores clip-path=none", () => {
    expect(
      clipped(`<rect clip-path="none" width="9" height="9"/>`).some(
        (n) => n.type === "clip-path-push",
      ),
    ).toBe(false);
  });
});

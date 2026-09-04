import { describe, it, expect } from "vitest";
import { svgToIr, SvgParseError, SvgUnsupportedError } from "../../../src/lib/svg/index.ts";
import type { Path } from "../../../src/lib/ir/display-list.ts";

// Everything here was found by running 10,819 real SVG files off a working machine through the
// parser. Each case is a class that either FAILED for no reason or, worse, rendered silently wrong.

const BOX = { x: 0, y: 0, width: 20, height: 20 };
const ir = (body: string, root = `<svg viewBox="0 0 20 20">`) =>
  svgToIr(`${root}${body}</svg>`, BOX);
const paths = (body: string, root?: string) =>
  ir(body, root).filter((n): n is Path => n.type === "path");

describe("editor metadata in a foreign namespace", () => {
  it("is ignored - it draws nothing, and refusing it failed 12 real Inkscape files", () => {
    expect(
      paths(`<sodipodi:namedview id="nv" pagecolor="#fff"/><rect width="9" height="9"/>`),
    ).toHaveLength(1);
    expect(paths(`<i:pgf id="adobe"/><rect width="9" height="9"/>`)).toHaveLength(1);
  });

  it("still reads an element written with the svg: prefix", () => {
    expect(paths(`<svg:rect width="9" height="9"/>`)).toHaveLength(1);
  });
});

describe("CSS at-rules", () => {
  const css = (block: string) =>
    paths(`<style>${block}</style><rect class="a" width="9" height="9"/>`);

  it("are dropped rather than fatal - 68 real files carry one that can never apply", () => {
    // `@media (prefers-color-scheme: dark)` and `@keyframes` cannot apply to a static page. Refusing
    // them meant those files did not render AT ALL.
    expect(
      css(`@media (prefers-color-scheme:dark){.a{fill:red}}`)[0]!.fill?.toPDFColorString(),
    ).toBe("0.000 0.000 0.000");
    expect(css(`@keyframes spin{from{fill:red}}`)).toHaveLength(1);
  });

  it("but a print query DOES apply, because it holds here", () => {
    expect(css(`@media print{.a{fill:#1450aa}}`)[0]!.fill?.toPDFColorString()).toBe(
      "0.078 0.314 0.667",
    );
  });
});

describe("a file that is not SVG", () => {
  it("says so instead of dying inside the parser", () => {
    // The corpus turned up build-cache blobs carrying a .svg extension; they crashed with a
    // TypeError from deep inside the tree walk.
    const binary = "& not markup";
    expect(() => svgToIr(binary, BOX)).toThrow(SvgParseError);
    expect(() => svgToIr(binary, BOX)).toThrow(/binary data/);
    expect(() => svgToIr('{"a":1}', BOX)).toThrow(/no <svg> element/);
  });
});

describe("attributes that change the picture", () => {
  // Ignoring one does not lose a detail - it draws something the file did not describe. `clip-path`
  // is in 3.2% of real files, and we were drawing those shapes past their frame in silence.
  it("names clip-path, mask and filter", () => {
    expect(() => paths(`<g clip-path="url(#a)"><rect width="9" height="9"/></g>`)).toThrow(
      SvgUnsupportedError,
    );
    expect(() => paths(`<rect mask="url(#m)" width="9" height="9"/>`)).toThrow(/mask/);
    expect(() => paths(`<rect filter="url(#f)" width="9" height="9"/>`)).toThrow(/filter/);
  });

  it("accepts the explicit absence of one", () => {
    expect(paths(`<rect clip-path="none" filter="none" width="9" height="9"/>`)).toHaveLength(1);
  });
});

describe("preserveAspectRatio", () => {
  it("accepts the default, spelled out or omitted", () => {
    expect(
      paths(
        `<rect width="9" height="9"/>`,
        `<svg viewBox="0 0 20 20" preserveAspectRatio="xMidYMid meet">`,
      ),
    ).toHaveLength(1);
  });

  it("names any other value, which would move or crop the drawing", () => {
    expect(() =>
      paths(
        `<rect width="9" height="9"/>`,
        `<svg viewBox="0 0 20 20" preserveAspectRatio="xMinYMin slice">`,
      ),
    ).toThrow(/preserveAspectRatio/);
  });
});

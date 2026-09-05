import { describe, it, expect } from "vitest";
import { svgToIr, SvgParseError } from "../../../src/lib/svg/index.ts";
import { Svg } from "../../../src/lib/api/index.ts";
import type { Path } from "../../../src/lib/ir/display-list.ts";

// What a user hands the library is a file they did not write. It may be truncated, generated, or not
// SVG at all. None of that may reach them as a raw JavaScript error - and none of it may take the
// process down.

const BOX = { x: 0, y: 0, width: 100, height: 100 };
const ir = (source: string) => svgToIr(source, BOX);
const paths = (source: string) => ir(source).filter((n): n is Path => n.type === "path");

describe("it degrades instead of failing", () => {
  it("draws what it can of a truncated file", () => {
    expect(() => paths('<svg viewBox="0 0 10 10"><g><rect width="5" height="5"/>')).not.toThrow();
    expect(paths('<svg viewBox="0 0 10 10"><g><rect width="5" height="5"/>')).toHaveLength(1);
  });

  it("names a `d` it cannot read, instead of drawing nothing in silence", () => {
    // svgpath REPORTS a malformed `d` on the instance rather than throwing, so an unchecked call
    // just yields no segments and the shape disappears.
    expect(() => paths('<svg viewBox="0 0 10 10"><path d="M zz 0 L !! 9"/></svg>')).toThrow(
      /path data could not be read/,
    );
  });

  it("treats an unreadable dimension as absent, not as NaN", () => {
    // A NaN would travel all the way to the content stream, where the backend refuses it.
    expect(paths('<svg viewBox="0 0 10 10"><rect width="NaN" height="abc"/></svg>')).toHaveLength(
      0,
    );
    expect(
      paths('<svg viewBox="0 0 10 10"><rect width="1e400" height="1e400"/></svg>'),
    ).toHaveLength(0);
  });

  it("falls back when the viewBox is unusable", () => {
    expect(paths('<svg viewBox="a b c d"><rect width="5" height="5"/></svg>')).toHaveLength(1);
    expect(paths('<svg viewBox="0 0 0 10"><rect width="5" height="5"/></svg>')).toHaveLength(1);
  });
});

describe("it names what it cannot use", () => {
  it("says a file is not SVG", () => {
    expect(() => ir("")).toThrow(SvgParseError);
    expect(() => ir("hallo")).toThrow(/no <svg> element/);
  });

  it("quotes a colour it cannot read, instead of a bare Unknown color", () => {
    // Inside a 900-element logo the raw message says nothing about WHERE - and a malformed file
    // arrives here with pieces of its own markup as the value.
    expect(() =>
      paths('<svg viewBox="0 0 10 10"><rect fill="chartrouge" width="5" height="5"/></svg>'),
    ).toThrow(SvgParseError);
    expect(() =>
      paths('<svg viewBox="0 0 10 10"><rect fill="chartrouge" width="5" height="5"/></svg>'),
    ).toThrow(/"chartrouge" is not a colour/);
  });

  it("names an unknown transform function", () => {
    expect(() =>
      paths(
        '<svg viewBox="0 0 10 10"><g transform="wobble(3)"><rect width="5" height="5"/></g></svg>',
      ),
    ).toThrow(/wobble/);
  });
});

describe("it cannot be made to crash", () => {
  it("refuses a file that nests deeper than any drawing, instead of blowing the stack", () => {
    // 20,000 nested groups produced a raw `RangeError: Maximum call stack size exceeded` - which is
    // not an error a caller can act on, and in a server it takes the request with it.
    const deep =
      '<svg viewBox="0 0 10 10">' +
      "<g>".repeat(20000) +
      '<rect width="5" height="5"/>' +
      "</g>".repeat(20000) +
      "</svg>";
    expect(() => ir(deep)).toThrow(SvgParseError);
    expect(() => ir(deep)).toThrow(/nests more than/);
  });

  it("survives a clip that references itself", () => {
    expect(() =>
      paths(
        '<svg viewBox="0 0 10 10"><clipPath id="a"><rect clip-path="url(#a)" width="5" height="5"/>' +
          '</clipPath><rect clip-path="url(#a)" width="5" height="5"/></svg>',
      ),
    ).not.toThrow();
  });
});

describe("the error lands where the file was named", () => {
  it("throws from Svg(), not from a later render", () => {
    // Half the errors used to surface at construction (the parse) and half during rendering (the
    // walk), which made them a lottery. The constructor now walks the whole document once.
    expect(() => Svg('<svg viewBox="0 0 10 10"><text>Acme</text></svg>')).toThrow(/<text>/);
    // A string that is neither markup nor a readable path used to surface as a bare ENOENT, which
    // never mentions that the argument was taken as a PATH.
    expect(() => Svg("not an svg at all")).toThrow(/taken as a path/);
  });
});

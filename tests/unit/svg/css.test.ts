import { describe, it, expect } from "vitest";
import { svgToIr, SvgUnsupportedError } from "../../../src/lib/svg/index.ts";
import type { Path } from "../../../src/lib/ir/display-list.ts";

// Illustrator's DEFAULT export option is "Internal CSS": every fill goes into a class and the shapes
// carry nothing but `class="st0"`. Dropping the block does not lose a detail - it makes the whole
// logo BLACK. It did exactly that here until this module existed, which is the same failure this
// codebase criticises react-pdf for (they at least warn).

const fillOf = (body: string): string | undefined =>
  (
    svgToIr(`<svg viewBox="0 0 20 20">${body}</svg>`, {
      x: 0,
      y: 0,
      width: 20,
      height: 20,
    }).find((n): n is Path => n.type === "path")?.fill as { toPDFColorString(): string } | undefined
  )?.toPDFColorString();

const BLUE = "0.078 0.314 0.667";
const BLACK = "0.000 0.000 0.000";

describe("a <style> block", () => {
  it("colours a shape by its class - the Illustrator export", () => {
    expect(
      fillOf(`<style>.st0{fill:#1450AA}</style><rect class="st0" width="9" height="9"/>`),
    ).toBe(BLUE);
  });

  it("is found inside <defs>, which the walk itself skips", () => {
    expect(
      fillOf(`<defs><style>.a{fill:#1450AA}</style></defs><rect class="a" width="9" height="9"/>`),
    ).toBe(BLUE);
  });

  it("matches by tag and by id as well", () => {
    expect(fillOf(`<style>rect{fill:#1450AA}</style><rect width="9" height="9"/>`)).toBe(BLUE);
    expect(fillOf(`<style>#a{fill:#1450AA}</style><rect id="a" width="9" height="9"/>`)).toBe(BLUE);
  });

  it("needs EVERY class of a compound selector", () => {
    const css = `<style>.a.b{fill:#1450AA}</style>`;
    expect(fillOf(`${css}<rect class="a b" width="9" height="9"/>`)).toBe(BLUE);
    expect(fillOf(`${css}<rect class="a" width="9" height="9"/>`)).toBe(BLACK);
  });

  it("shares declarations across a comma-separated selector list", () => {
    const css = `<style>.a,.b{fill:#1450AA}</style>`;
    expect(fillOf(`${css}<rect class="b" width="9" height="9"/>`)).toBe(BLUE);
  });

  it("ignores comments", () => {
    expect(
      fillOf(`<style>/* brand */.a{fill:#1450AA}</style><rect class="a" width="9" height="9"/>`),
    ).toBe(BLUE);
  });
});

describe("the cascade", () => {
  it("beats a presentation attribute", () => {
    expect(
      fillOf(`<style>.a{fill:#1450AA}</style><rect class="a" fill="#000" width="9" height="9"/>`),
    ).toBe(BLUE);
  });

  it("loses to the inline style bag", () => {
    expect(
      fillOf(
        `<style>.a{fill:#000000}</style><rect class="a" style="fill:#1450AA" width="9" height="9"/>`,
      ),
    ).toBe(BLUE);
  });

  it("lets an id beat a class, and a class beat a tag", () => {
    expect(
      fillOf(
        `<style>rect{fill:#000}.a{fill:#000}#x{fill:#1450AA}</style>` +
          `<rect id="x" class="a" width="9" height="9"/>`,
      ),
    ).toBe(BLUE);
    expect(
      fillOf(
        `<style>.a{fill:#1450AA}rect{fill:#000}</style><rect class="a" width="9" height="9"/>`,
      ),
    ).toBe(BLUE);
  });

  it("lets the later rule win at equal specificity, as CSS does", () => {
    expect(
      fillOf(`<style>.a{fill:#000}.a{fill:#1450AA}</style><rect class="a" width="9" height="9"/>`),
    ).toBe(BLUE);
  });

  it("inherits a class-set fill to children, like any other fill", () => {
    expect(
      fillOf(`<style>.a{fill:#1450AA}</style><g class="a"><rect width="9" height="9"/></g>`),
    ).toBe(BLUE);
  });
});

describe("what it refuses, rather than silently mismatching", () => {
  // A selector that quietly fails to match is the black logo again, one level down.
  it("names a combinator", () => {
    expect(() => fillOf(`<style>g > rect{fill:red}</style><rect width="9" height="9"/>`)).toThrow(
      SvgUnsupportedError,
    );
    expect(() => fillOf(`<style>g rect{fill:red}</style><rect width="9" height="9"/>`)).toThrow(
      /combines elements/,
    );
  });

  it("names a pseudo-class or attribute selector", () => {
    expect(() => fillOf(`<style>rect:hover{fill:red}</style><rect width="9" height="9"/>`)).toThrow(
      /pseudo-class/,
    );
  });

  // At-rules used to be refused here too. The corpus overruled that: 68 of 10,819 real files carry a
  // `@media (prefers-color-scheme)` or a `@keyframes`, none of which can apply to a static page, and
  // being fatal meant those files did not render at all. They are dropped now - see
  // `robustness.test.ts`, which pins both halves of that rule.

  it("names !important, which would need a second cascade level", () => {
    expect(() =>
      fillOf(`<style>.a{fill:red !important}</style><rect class="a" width="9" height="9"/>`),
    ).toThrow(/important/);
  });
});

import { describe, it, expect } from "vitest";
import { h, type Component } from "vue";
import {
  Document,
  Page,
  Svg,
  Image,
  toDocumentDescriptor,
  renderToPdfString,
} from "../src/index.ts";

// A factory the engine exposes but the binding never declares is a feature a Vue user cannot reach.
// `Svg` was exactly that until this branch - the same drift `text-props.test.ts` guards for text.

const comp = (render: () => any): Component => ({ render });
const MARK = `<svg viewBox="0 0 10 10"><rect width="9" height="9" fill="#1450aa"/></svg>`;

describe("<JasySvg>", () => {
  it("declares the options the Svg factory takes", () => {
    const props = Object.keys((Svg as { props?: object }).props ?? {});
    expect(props).toEqual(expect.arrayContaining(["src", "width", "height", "alt"]));
  });

  it("reaches the descriptor as an `svg` node", () => {
    const desc = toDocumentDescriptor(
      comp(() => h(Document, null, () => h(Page, null, () => h(Svg, { src: MARK, width: 40 })))),
    );
    const page = desc.children![0] as {
      children: { type: string; props: Record<string, unknown> }[];
    };
    expect(page.children[0]!.type).toBe("svg");
    expect(page.children[0]!.props["width"]).toBe(40);
  });

  it("renders to a PDF that really contains the drawing", async () => {
    const pdf = await renderToPdfString(
      comp(() => h(Document, null, () => h(Page, null, () => h(Svg, { src: MARK, width: 40 })))),
      undefined,
      { compress: false },
    );
    // The rect's fill, as the backend writes a colour.
    expect(pdf).toContain("0.078 0.314 0.667 rg");
  });

  it("routes an SVG given to <JasyImage> the same way", async () => {
    const pdf = await renderToPdfString(
      comp(() => h(Document, null, () => h(Page, null, () => h(Image, { src: MARK, width: 40 })))),
      undefined,
      { compress: false },
    );
    expect(pdf).toContain("0.078 0.314 0.667 rg");
  });
});

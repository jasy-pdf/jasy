import { describe, it, expect } from "vitest";
import { Document, Page, Svg } from "../../../src/lib/api/index.ts";
import { renderPdf } from "../../../src/lib/api/structure.ts";

// A drawing with `alt` is a Figure in the tagged tree; without it, decoration. Same contract as an
// Image - the engine owns the tagging, the component only declares a role.

const MARK = `<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#1450aa"/></svg>`;
const render = (alt?: string) =>
  renderPdf(Document([Page([Svg(MARK, { width: 40, ...(alt ? { alt } : {}) })])]), {
    accessible: true,
    title: "t",
    lang: "en",
  });

describe("an SVG in an accessible document", () => {
  it("becomes a Figure carrying its alt text", async () => {
    const pdf = await render("The Acme mark");
    expect(pdf).toContain("/Figure");
    expect(pdf).toContain("The Acme mark");
  });

  it("is an Artifact without alt - decoration, skipped by a screen reader", async () => {
    const pdf = await render();
    expect(pdf).not.toContain("/Figure");
  });
});

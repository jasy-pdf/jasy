// `ligatures` and `wordSpacing` on a span: set there they apply to that run, unset they inherit the
// Text's. Both change widths, so the breaker, the drawing and justification all have to agree.
//
// The fixture font merges A+B into glyph 4 (600 units); apart A is 500, B 700, a space 250. At 10pt:
// "AB" merged 6, apart 12, a space 2.5.
import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { buildLigatureTtf } from "../utils/ttf-fixture.ts";
import { TextElement, type TextSegment } from "../../../src/lib/elements/text-element.ts";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { TextRenderer } from "../../../src/lib/renderer/text-renderer.ts";
import type { TextRun } from "../../../src/lib/ir/display-list.ts";
import { PAGE_SCOPE } from "../support/scope.ts";

const FONT = { fontFamily: "Lig", fontSize: 10, fontStyle: FontStyle.Normal };

const drawn = async (content: TextSegment[], opts: object = {}, width = 200) => {
  const m = new PDFObjectManager();
  m.registerCustomFont("Lig", new Uint8Array(buildLigatureTtf()));
  m.setKerning(false);
  const el = new TextElement({ content, ...FONT, ...opts });
  el.calculateLayout(BoxConstraints.tight(width, 100), { x: 0, y: 0 }, {
    metrics: m,
    pageConfig: {},
  } as never);
  return (await TextRenderer.render(el, m, PAGE_SCOPE)).filter(
    (n): n is TextRun => n.type === "text",
  );
};

describe("ligatures on a span", () => {
  it("switched off on one span, that run is drawn apart and the next starts after it", async () => {
    const runs = await drawn([{ content: "AB ", ligatures: false }, { content: "AB" }]);
    expect(runs.map((r) => r.glyphs ?? null)).toEqual([null, [4]]);
    expect(runs[1]!.x).toBe(14.5); // 5 + 7 + 2.5: what the first span DRAWS
  });

  it("switched on in a span of a Text that has them off", async () => {
    const runs = await drawn([{ content: "AB " }, { content: "AB", ligatures: true }], {
      ligatures: false,
    });
    expect(runs.map((r) => r.glyphs ?? null)).toEqual([null, [4]]);
  });
});

describe("wordSpacing on a span", () => {
  it("widens the spaces of that run only", async () => {
    const runs = await drawn([{ content: "AB AB", wordSpacing: 6 }, { content: " AB AB" }]);
    // In the first span a word starts 6 + 2.5 + 6 after the last; the second span adds nothing.
    expect(runs.map((r) => r.x)).toEqual([0, 14.5, 20.5]);
    expect(runs[2]!.text).toBe(" AB AB");
  });

  it("a span can take the Text's away", async () => {
    const runs = await drawn([{ content: "AB AB", wordSpacing: 0 }], { wordSpacing: 6 });
    expect(runs.map((r) => r.x)).toEqual([0]); // one run: no extra advance to place words apart
  });

  it("is what the breaker breaks with: a justified line ends exactly at the box edge", async () => {
    // Width 60. The first span's spaces are 8.5 wide, the second's 2.5. Five "AB" need 64 at natural
    // spacing; the breaker may squeeze the four gaps by a quarter of THEIR widths (8.5), so the fifth
    // word stays, and the drawing must squeeze exactly that: 4 x 1 = 4, ending at 60.
    const runs = await drawn(
      [{ content: "AB AB AB AB ", wordSpacing: 6 }, { content: "AB AB AB AB AB AB" }],
      { textAlignment: HorizontalAlignment.justify },
      60,
    );
    const firstLine = runs.slice(0, 5);
    expect(firstLine.map((r) => r.x)).toEqual([0, 13.5, 27, 40.5, 54]);
    expect(firstLine[4]!.x + 6).toBe(60);
  });
});

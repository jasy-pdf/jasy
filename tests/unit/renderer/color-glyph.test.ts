import { describe, it, expect } from "vitest";
import { TextRenderer } from "../../../src/lib/renderer/text-renderer";
import { TextElement } from "../../../src/lib/elements/text-element";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element";
import { Color } from "../../../src/lib/common/color";
import { IRNode, Path, TextRun } from "../../../src/lib/ir/display-list";
import { buildTestTtf, buildColorTtf, buildColorV1Ttf } from "../utils/ttf-fixture";

// A laid-out TextElement carrying `content` in the "Emoji" family at a known origin.
const textElement = (content: string): TextElement =>
  ({
    getProps: () => ({
      x: 10,
      y: 20,
      width: undefined,
      fontSize: 100,
      color: new Color(0, 0, 0),
      content,
      fontFamily: "Emoji",
      fontStyle: FontStyle.Normal,
      textAlignment: HorizontalAlignment.left,
      maxLines: undefined,
      overflow: undefined,
      lineHeight: 1,
    }),
  }) as unknown as TextElement;

const withColorFont = (): PDFObjectManager => {
  const om = new PDFObjectManager();
  om.registerCustomFont("Emoji", buildColorTtf(0x1f600));
  return om;
};

describe("TextRenderer - COLR color glyph expansion", () => {
  it("expands a lone emoji into one filled Path per palette layer (red then blue)", async () => {
    const nodes = await TextRenderer.render(textElement("😀"), withColorFont());

    const paths = nodes.filter((n): n is Path => n.type === "path");
    expect(nodes).toHaveLength(2); // only the two layers, no text run
    expect(paths).toHaveLength(2);
    // v0 layers are solid Colors (not gradients).
    expect((paths[0].fill as Color).toPDFColorString()).toBe("1.000 0.000 0.000"); // layer 0 = red
    expect((paths[1].fill as Color).toPDFColorString()).toBe("0.000 0.000 1.000"); // layer 1 = blue
    expect(paths[0].commands[0].op).toBe("m"); // real outline, starts with a moveTo
  });

  it("keeps surrounding text as runs and places the emoji layers between them", async () => {
    const nodes = await TextRenderer.render(textElement("A😀B"), withColorFont());

    expect(nodes.map((n) => n.type)).toEqual(["text", "path", "path", "text"]);
    const before = nodes[0] as TextRun;
    const after = nodes[3] as TextRun;
    expect(before.text).toBe("A");
    expect(after.text).toBe("B");
    // "A" is .notdef here (advance 0); the emoji advances by one em (fontSize) -> B sits after it.
    expect(after.x - before.x).toBeCloseTo(100, 3);
  });

  it("expands a COLR v1 glyph into a solid layer + a gradient layer", async () => {
    const om = new PDFObjectManager();
    om.registerCustomFont("Emoji", buildColorV1Ttf(0x1f600));
    const nodes = await TextRenderer.render(textElement("😀"), om);

    const paths = nodes.filter((n): n is Path => n.type === "path");
    expect(paths).toHaveLength(2);

    // Layer 0: solid red (a Color fill).
    expect(paths[0].fill).toBeInstanceOf(Color);
    expect((paths[0].fill as Color).toPDFColorString()).toBe("1.000 0.000 0.000");

    // Layer 1: a linear gradient, red -> blue, positioned in page space.
    const grad = paths[1].fill;
    expect(grad).not.toBeInstanceOf(Color);
    if (!(grad instanceof Color) && grad.type === "linear") {
      expect(grad.stops.map((s) => s.color.toPDFColorString())).toEqual([
        "1.000 0.000 0.000",
        "0.000 0.000 1.000",
      ]);
    }
  });

  it("leaves a normal (monochrome) font's run untouched", async () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica");
    const nodes: IRNode[] = await TextRenderer.render(
      {
        getProps: () => ({
          x: 0,
          y: 0,
          width: undefined,
          fontSize: 12,
          color: new Color(0, 0, 0),
          content: "hi",
          fontFamily: "Helvetica",
          fontStyle: FontStyle.Normal,
          textAlignment: HorizontalAlignment.left,
          lineHeight: 1,
        }),
      } as unknown as TextElement,
      om,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("text");
  });

  // Regression: a color font co-registered in the same document must not disturb a normal custom
  // font's embedding/subsetting - the normal font still embeds (one /FontFile2), and the emoji draws
  // as a vector fill rather than as embedded-font text (so the color font itself is not embedded).
  it("a co-registered color font does not interfere with a normal font's embedding", async () => {
    const { renderPdf, Document, Page } = await import("../../../src/lib/api/structure");
    const { Text } = await import("../../../src/lib/api");

    const pdf = await renderPdf(
      Document([Page([Text("AB", { font: "Normal" }), Text("😀", { font: "Emoji", size: 20 })])]),
      { fonts: { Normal: buildTestTtf(), Emoji: buildColorTtf() }, compress: false },
    );

    expect(pdf.startsWith("%PDF")).toBe(true);
    // The normal font is embedded + subsetted (a subset-tagged BaseFont + a FontFile2 program)...
    expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+/);
    expect((pdf.match(/\/FontFile2/g) ?? []).length).toBe(1); // ...and ONLY it (emoji font not embedded)
    // The emoji renders as its red vector layer, not as embedded-font glyphs.
    expect(pdf).toContain("1.000 0.000 0.000 rg");
  });
});

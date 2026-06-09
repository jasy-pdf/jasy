import { describe, it, expect } from "vitest";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { TextElement } from "../../../src/lib/elements/text-element";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { PageSize, pageFormats } from "../../../src/lib/constants/page-sizes";
import { Orientation } from "../../../src/lib/renderer/pdf-config";

// Regression for the per-page-config bug: before Phase 2 the page config was a global
// singleton (last constructed page wins), so every page flipped its Y against the LAST
// page's height. Now each page threads its own geometry through the layout context.
describe("mixed page sizes - per-page config", () => {
  it("flips each page's content against that page's own height", () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica"); // the default font, needed for measuring
    const ctx: LayoutContext = { metrics: om, pageConfig: om.getPDFConfig() };

    // Identical text at the top of two differently-sized pages.
    const a4Text = new TextElement({ fontSize: 12, content: "X" });
    const a5Text = new TextElement({ fontSize: 12, content: "X" });

    const doc = new PDFDocumentElement({
      children: [
        new PageElement({
          config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
          children: [a4Text],
        }),
        new PageElement({
          config: { pageSize: PageSize.A5, orientation: Orientation.landscape },
          children: [a5Text],
        }),
      ],
    });

    doc.calculateLayout(undefined, ctx);

    // Default margin.top = 72; text baseline offset = fontSize * 683/1000.
    const marginTop = 72;
    const baseline = 12 * (683 / 1000);
    const a4Height = pageFormats[PageSize.A4][1]; // portrait
    const a5LandscapeHeight = pageFormats[PageSize.A5][0]; // landscape swaps the axes

    // Each text's normalized Y = pageHeight - margin - baseline, using ITS OWN page.
    expect(a4Text.getProps().y).toBeCloseTo(a4Height - marginTop - baseline, 2);
    expect(a5Text.getProps().y).toBeCloseTo(
      a5LandscapeHeight - marginTop - baseline,
      2
    );

    // And crucially they differ - the bug made them equal (both on the last page's height).
    expect(a4Text.getProps().y).not.toBe(a5Text.getProps().y);
  });
});

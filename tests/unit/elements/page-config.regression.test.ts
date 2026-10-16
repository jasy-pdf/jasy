import { describe, it, expect } from "vitest";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { TextElement } from "../../../src/lib/elements/text-element";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { TextRun } from "../../../src/lib/ir/display-list";
import { Color } from "../../../src/lib/common/color";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { PageSize, pageFormats } from "../../../src/lib/constants/page-sizes";
import { Orientation } from "../../../src/lib/renderer/pdf-config";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";

// Regression for the per-page-config bug: before Phase 2 the page config was a global
// singleton (last constructed page wins), so every page flipped its Y against the LAST
// page's height. The fix has two halves, both checked here:
//   1) layout is page-independent (top-left coordinates, identical for both pages);
//   2) the Y-flip happens per page at the IR -> backend seam, against THAT page's height.
describe("mixed page sizes - per-page config", () => {
  it("lays out text page-independently; the seam flips per page height", () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica"); // default font, needed for measuring
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

    doc.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctx);

    // (1) Layout is now page-independent: both texts share the same top-left Y (the top
    // margin). The old bug baked a per-page flip into the element here.
    expect(a4Text.getProps().y).toBe(a5Text.getProps().y);

    // (2) The per-page difference comes from the seam flip against each page's height.
    const a4Height = pageFormats[PageSize.A4][1]; // portrait: tall axis
    const a5LandscapeHeight = pageFormats[PageSize.A5][0]; // landscape swaps the axes

    const node: TextRun = {
      type: "text",
      x: 0,
      y: 100,
      text: "X",
      fontFamily: "Helvetica",
      fontStyle: FontStyle.Normal,
      fontSize: 12,
      color: new Color(0, 0, 0),
    };
    const a4 = PdfBackend.flipY([node], a4Height)[0] as TextRun;
    const a5 = PdfBackend.flipY([node], a5LandscapeHeight)[0] as TextRun;

    expect(a4.y).toBe(a4Height - 100);
    expect(a5.y).toBe(a5LandscapeHeight - 100);
    expect(a4.y).not.toBe(a5.y); // different page heights -> different placement
  });
});

// A page's own config is merged with the document defaults on every layout - from what the page
// SAYS, not from the result of the last merge. Merging into its own field made the first defaults
// stick, and pagination read a config that existed only because an earlier pass had mutated it.
describe("the page config is resolved, not accumulated", () => {
  const om = new PDFObjectManager();
  om.registerFont("Helvetica");
  const ctxWith = (margin: number): LayoutContext => ({
    metrics: om,
    pageConfig: {
      ...om.getPDFConfig(),
      margin: { top: margin, right: margin, bottom: margin, left: margin },
    },
  });

  it("a second layout under other defaults uses those defaults", () => {
    const text = new TextElement({ fontSize: 12, content: "X" });
    const page = new PageElement({ config: { pageSize: PageSize.A5 }, children: [text] });
    page.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctxWith(10));
    page.calculateLayout(new BoxConstraints(), { x: 0, y: 0 }, ctxWith(40));
    expect(text.getProps().x).toBe(40);
  });

  it("the page's own settings still win over the defaults", () => {
    const page = new PageElement({ config: { pageSize: PageSize.A5 }, children: [] });
    expect(
      page.resolveConfig({
        pageSize: PageSize.A4,
        margin: { top: 5, right: 5, bottom: 5, left: 5 },
      }),
    ).toMatchObject({
      pageSize: PageSize.A5,
      margin: { top: 5, right: 5, bottom: 5, left: 5 },
    });
  });
});

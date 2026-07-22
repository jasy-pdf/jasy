import { describe, it, expect } from "vitest";
import {
  layoutPageBands,
  resolvePageContentBox,
  PDFPageConfig,
} from "../../../src/lib/elements/page-element";
import { LayoutContext, PDFElement } from "../../../src/lib/elements/pdf-element";
import { BoxConstraints, Offset, Size } from "../../../src/lib/layout/box-constraints";
import { PageSize } from "../../../src/lib/constants/page-sizes";
import { Orientation } from "../../../src/lib/renderer/pdf-config";
import { PDFDocument } from "../../../src/lib/renderer/pdf-document-class";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { TextElement } from "../../../src/lib/elements/text-element";

// A fixed-size element that records where it was placed and the height it was offered.
class MockBox extends PDFElement {
  placedAt?: Offset;
  offeredMaxHeight?: number;
  constructor(private size: Size) {
    super();
  }
  getProps(): unknown {
    return {};
  }
  calculateLayout(c: BoxConstraints, offset: Offset, _ctx?: LayoutContext): Size {
    this.placedAt = offset;
    this.offeredMaxHeight = c.maxHeight;
    return this.size;
  }
}

const ctx = {} as LayoutContext;
const config: PDFPageConfig = {
  pageSize: PageSize.A4,
  orientation: Orientation.portrait,
  margin: { top: 40, right: 40, bottom: 40, left: 40 },
};

describe("layoutPageBands - header/footer reserve their bands", () => {
  it("no header/footer: body equals the full content box (unchanged)", () => {
    const { origin, width, height } = resolvePageContentBox(config);
    const bands = layoutPageBands(config, undefined, undefined, ctx);

    expect(bands.bodyOrigin).toEqual(origin);
    expect(bands.bodyWidth).toBe(width);
    expect(bands.bodyHeight).toBe(height);
    expect(bands.headerHeight).toBe(0);
    expect(bands.footerHeight).toBe(0);
  });

  it("header pushes the body down and shrinks it by the header height", () => {
    const { origin, height } = resolvePageContentBox(config);
    const header = new MockBox({ width: 0, height: 30 });

    const bands = layoutPageBands(config, header, undefined, ctx);

    expect(header.placedAt!.y).toBe(origin.y); // header at the top of the content box
    expect(bands.bodyOrigin.y).toBe(origin.y + 30);
    expect(bands.bodyHeight).toBe(height - 30);
  });

  it("footer is placed flush against the bottom and shrinks the body", () => {
    const { origin, height } = resolvePageContentBox(config);
    const footer = new MockBox({ width: 0, height: 25 });

    const bands = layoutPageBands(config, undefined, footer, ctx);

    expect(footer.placedAt!.y).toBe(origin.y + height - 25); // bottom band
    expect(bands.bodyOrigin.y).toBe(origin.y); // body still starts at the top
    expect(bands.bodyHeight).toBe(height - 25);
  });

  it("both bands subtract from the body; the body is offered the reduced height", () => {
    const { height } = resolvePageContentBox(config);
    const header = new MockBox({ width: 0, height: 30 });
    const footer = new MockBox({ width: 0, height: 20 });
    const body = new MockBox({ width: 0, height: 10 });

    const bands = layoutPageBands(config, header, footer, ctx);
    body.calculateLayout(
      BoxConstraints.loose(bands.bodyWidth, bands.bodyHeight),
      bands.bodyOrigin,
      ctx,
    );

    expect(bands.bodyHeight).toBe(height - 50);
    expect(body.offeredMaxHeight).toBe(height - 50);
  });
});

// Render-level: the header/footer must repeat on every physical page of an overflow.
const stack = (n: number) =>
  new ContainerElement({
    x: 0,
    y: 0,
    children: Array.from(
      { length: n },
      (_, i) => new TextElement({ fontSize: 24, content: `Block ${i}` }),
    ),
  });

class HeaderFooterDoc extends PDFDocument {
  // This suite asserts exact text markers (PAGEHEAD, Block N); kerning would split them into TJ
  // chunks. It tests pagination, not text, so render un-kerned for a deterministic grep.
  constructor() {
    super();
    this.objectManager.setKerning(false);
  }
  build(): PDFDocumentElement {
    return new PDFDocumentElement({
      children: [
        new PageElement({
          config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
          header: new TextElement({ fontSize: 12, content: "PAGEHEAD" }),
          footer: new TextElement({ fontSize: 12, content: "PAGEFOOT" }),
          children: [stack(80)], // overflows several pages
        }),
      ],
    });
  }
}

const countPages = (pdf: string) => pdf.split("/MediaBox").length - 1;
const countOf = (pdf: string, needle: string) => pdf.split(needle).length - 1;

describe("page driver - header/footer repeat on every physical page", () => {
  it("emits the header and footer once per physical page", async () => {
    const pdf = await HeaderFooterDoc.render();
    const pages = countPages(pdf);

    expect(pages).toBeGreaterThan(1);
    expect(countOf(pdf, "(PAGEHEAD)")).toBe(pages);
    expect(countOf(pdf, "(PAGEFOOT)")).toBe(pages);
  });

  it("still flows the body in order across the pages", async () => {
    const pdf = await HeaderFooterDoc.render();
    expect(pdf.indexOf("(Block 0)")).toBeLessThan(pdf.indexOf("(Block 79)"));
    for (const i of [0, 40, 79]) expect(pdf).toContain(`(Block ${i})`);
  });
});

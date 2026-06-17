import { describe, it, expect } from "vitest";
import { PDFDocument } from "../../../src/lib/renderer/pdf-document-class";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { TextElement } from "../../../src/lib/elements/text-element";
import { ExpandedElement } from "../../../src/lib/elements/layout/expanded-element";
import { PageSize } from "../../../src/lib/constants/page-sizes";
import { Orientation } from "../../../src/lib/renderer/pdf-config";

// Counts physical PDF pages: one /MediaBox is emitted per page object.
const countPages = (pdf: string) => pdf.split("/MediaBox").length - 1;

// A column of `n` single-line text blocks, tagged so we can locate them in the stream.
const stack = (n: number) =>
  new ContainerElement({
    x: 0,
    y: 0,
    children: Array.from(
      { length: n },
      (_, i) => new TextElement({ fontSize: 24, content: `Block ${i}` }),
    ),
  });

class OverflowingDoc extends PDFDocument {
  build(): PDFDocumentElement {
    return new PDFDocumentElement({
      children: [
        new PageElement({
          config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
          children: [stack(80)], // 80 * 24pt far exceeds one A4 page
        }),
      ],
    });
  }
}

class ShortDoc extends PDFDocument {
  build(): PDFDocumentElement {
    return new PDFDocumentElement({
      children: [
        new PageElement({
          config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
          children: [stack(3)], // comfortably fits one page
        }),
      ],
    });
  }
}

describe("Slice 0 pagination - atomic blocks reflow to new pages", () => {
  it("splits an overflowing column across several physical pages", async () => {
    const pdf = await OverflowingDoc.render();
    expect(countPages(pdf)).toBeGreaterThan(1);
  });

  it("keeps every block - none dropped at the page boundary", async () => {
    const pdf = await OverflowingDoc.render();
    for (let i = 0; i < 80; i++) {
      expect(pdf).toContain(`(Block ${i})`);
    }
  });

  it("places earlier blocks before later ones across the page sequence", async () => {
    const pdf = await OverflowingDoc.render();
    expect(pdf.indexOf("(Block 0)")).toBeLessThan(pdf.indexOf("(Block 79)"));
  });

  it("does not paginate content that fits on one page", async () => {
    const pdf = await ShortDoc.render();
    expect(countPages(pdf)).toBe(1);
  });
});

// Slice 1: a single paragraph taller than the page splits at line boxes.
class LongParagraphDoc extends PDFDocument {
  build(): PDFDocumentElement {
    const words = Array.from({ length: 1500 }, (_, i) => `w${String(i).padStart(4, "0")}`).join(
      " ",
    );
    return new PDFDocumentElement({
      children: [
        new PageElement({
          config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
          children: [
            new ContainerElement({
              x: 0,
              y: 0,
              children: [new TextElement({ fontSize: 14, content: words })],
            }),
          ],
        }),
      ],
    });
  }
}

describe("Slice 1 pagination - a paragraph splits at line boxes", () => {
  it("splits one tall paragraph across several pages", async () => {
    const pdf = await LongParagraphDoc.render();
    expect(countPages(pdf)).toBeGreaterThan(1);
  });

  it("keeps the word order across the split (early before late)", async () => {
    const pdf = await LongParagraphDoc.render();
    expect(pdf.indexOf("w0000")).toBeLessThan(pdf.indexOf("w1499"));
  });

  it("loses no words at the page boundary", async () => {
    const pdf = await LongParagraphDoc.render();
    for (const w of ["w0000", "w0750", "w1499"]) {
      expect(pdf).toContain(w);
    }
  });
});

// Slice 3: a container with a flex child paginates when it overflows (before, a flex
// child made the container bail out of pagination entirely and clip).
class FlexOverflowDoc extends PDFDocument {
  build(): PDFDocumentElement {
    const words = Array.from({ length: 1500 }, (_, i) => `f${String(i).padStart(4, "0")}`).join(
      " ",
    );
    return new PDFDocumentElement({
      children: [
        new PageElement({
          config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
          children: [
            new ContainerElement({
              x: 0,
              y: 0,
              children: [
                new TextElement({ fontSize: 14, content: "HEADER" }),
                new ExpandedElement({
                  flex: 1,
                  child: new TextElement({ fontSize: 14, content: words }),
                }),
              ],
            }),
          ],
        }),
      ],
    });
  }
}

describe("Slice 3 pagination - flex container flows when it overflows", () => {
  it("paginates instead of clipping the flex body", async () => {
    const pdf = await FlexOverflowDoc.render();
    expect(countPages(pdf)).toBeGreaterThan(1);
  });

  it("flows the flex body across pages, in order, losing nothing", async () => {
    const pdf = await FlexOverflowDoc.render();
    expect(pdf).toContain("(HEADER)");
    expect(pdf.indexOf("f0000")).toBeLessThan(pdf.indexOf("f1499"));
    for (const w of ["f0000", "f0750", "f1499"]) expect(pdf).toContain(w);
  });
});

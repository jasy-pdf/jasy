import { describe, it, expect } from "vitest";
import { PDFDocument } from "../../../src/lib/renderer/pdf-document-class";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { TextElement } from "../../../src/lib/elements/text-element";
import { PageSize } from "../../../src/lib/constants/page-sizes";
import { Orientation } from "../../../src/lib/renderer/pdf-config";
import { BoxConstraints, Offset, Size } from "../../../src/lib/layout/box-constraints";
import type { LayoutContext } from "../../../src/lib/elements/pdf-element";
import type { FragmentResult } from "../../../src/lib/layout/fragmentation";

// The general pagination termination guarantee. A fragmentation step that does NOT shrink the region
// (nothing fit even on a full page) must END the loop, not advance to an identical remainder forever.
// This is the backstop that keeps a future `keepTogether` bigger than a page - or any engine bug -
// from hanging. WITHOUT the guard these tests would time out instead of asserting.

// A region that refuses to make progress: taller than any page, never fits, never splits - it always
// hands back itself. (Exactly the shape a "keep this together" group bigger than one page produces.)
class NeverShrinks extends ContainerElement {
  override calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    const size = super.calculateLayout(constraints, offset, ctx);
    this.height = 5000; // far taller than any page, so it can genuinely never fit
    return { width: size.width, height: 5000 };
  }
  fragment(): FragmentResult {
    return { fitted: null, remainder: this };
  }
}

const docWith = (policy: "error" | "ignore") =>
  class extends PDFDocument {
    constructor() {
      super();
      this.objectManager.setOverflowPolicy(policy);
    }
    build(): PDFDocumentElement {
      return new PDFDocumentElement({
        children: [
          new PageElement({
            config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
            children: [
              new NeverShrinks({
                x: 0,
                y: 0,
                children: [
                  new TextElement({ fontSize: 12, content: "I never fit and never split." }),
                ],
              }),
            ],
          }),
        ],
      });
    }
  };

describe("pagination terminates even when a region never shrinks", () => {
  it("stops instead of looping forever, and reports the overflow as an error", async () => {
    // With the default policy the un-paginatable block is a hard error - but a FINITE one: the test
    // returns (rejects), it does not hang.
    await expect(docWith("error").render()).rejects.toThrow(/overflow/i);
  });

  it("with onOverflow 'ignore' it places the block once (clipped) and finishes", async () => {
    // No throw, no hang: exactly one physical page is produced and the loop ends.
    const pdf = await docWith("ignore").render();
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { PDFDocument } from "../../../src/lib/renderer/pdf-document-class.ts";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element.ts";
import { PageElement } from "../../../src/lib/elements/page-element.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { PageSize } from "../../../src/lib/constants/page-sizes.ts";
import { Orientation } from "../../../src/lib/renderer/pdf-config.ts";
import { MissingRendererError } from "../../../src/lib/utils/renderer-registry.ts";

// ISSUE-11: two loaded copies of @jasy/pdf give every element class a SECOND constructor, and the
// registry is keyed on the constructor - so copy B could not render a single element built by copy A.
// Every call site skipped what it could not render, so the document came out as a VALID PDF with an
// empty content stream: a blank page, no error, no warning. This pins the loud failure.
//
// A subclass reproduces the situation exactly: same behaviour, different constructor, not registered.
class ForeignText extends TextElement {}

const docWith = (content: TextElement) =>
  class extends PDFDocument {
    constructor() {
      super();
      this.objectManager.setCompress(false); // so the counter-test can read the drawn text
    }
    build(): PDFDocumentElement {
      return new PDFDocumentElement({
        children: [
          new PageElement({
            config: { pageSize: PageSize.A4, orientation: Orientation.portrait },
            children: [content],
          }),
        ],
      });
    }
  };

const text = () => ({ fontSize: 12, content: "Rendered by the right copy." });

describe("an element the registry does not know", () => {
  it("throws instead of rendering a blank page", async () => {
    await expect(docWith(new ForeignText(text())).render()).rejects.toThrow(MissingRendererError);
  });

  it("names the element and the duplicate-copy cause, so the error is actionable", async () => {
    await expect(docWith(new ForeignText(text())).render()).rejects.toThrow(
      /ForeignText.*two copies of @jasy\/pdf/s,
    );
  });

  // The counter-test: without it the two above would also pass if rendering were broken outright.
  it("still renders the same document when the element IS registered", async () => {
    const pdf = await docWith(new TextElement(text())).render();

    // The blank page was a VALID PDF whose content stream held nothing, so "it rendered" has to mean
    // drawing operators are actually there - not merely that a file came back.
    expect(pdf).toMatch(/BT\n.*Rendered b.*TJ\nET/s);
  });
});

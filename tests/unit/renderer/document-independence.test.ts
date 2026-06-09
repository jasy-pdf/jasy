import { describe, it, expect } from "vitest";
import { PDFDocument } from "../../../src/lib/renderer/pdf-document-class";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PageElement } from "../../../src/lib/elements/page-element";
import { TextElement } from "../../../src/lib/elements/text-element";

class TinyDoc extends PDFDocument {
  build(): PDFDocumentElement {
    return new PDFDocumentElement({
      children: [
        new PageElement({
          children: [new TextElement({ fontSize: 12, content: "Hello" })],
        }),
      ],
    });
  }
}

// Each document owns its object manager (no global singleton). Rendering twice must
// produce identical output - with the old shared manager the second render accumulated
// the first render's objects.
describe("document independence (no shared global state)", () => {
  it("renders the same document twice with identical output", async () => {
    const first = await TinyDoc.render();
    const second = await TinyDoc.render();
    expect(second).toBe(first);
  });
});

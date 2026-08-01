import { describe, it, expect } from "vitest";
import {
  Column,
  Document,
  Page,
  PageBuilder,
  SubPageCount,
  SubPageNumber,
  Text,
  renderToBytes,
} from "../../../src/lib/api/index.ts";
import { PdfDocument } from "../../../src/lib/edit/document.ts";
import { isStream } from "../../../src/lib/edit/objects.ts";

// `pageNumber` counts PHYSICAL pages across the whole document; `subPageNumber` counts within the
// logical `Page` element the author wrote. The case that makes it real: an invoice plus an attachment,
// where the footer should say "Attachment, page 1 of 4" beside "sheet 4 of 7".

/** The text drawn on each page, in order - read back with our own parser rather than guessing at bytes. */
const pageTexts = (bytes: Uint8Array): string[] => {
  const doc = PdfDocument.load(bytes);
  const kids = doc.lookup(doc.lookup(doc.catalog, "Pages"), "Kids");
  return (Array.isArray(kids) ? kids : []).map((ref) => {
    const contents = doc.lookup(doc.resolve(ref), "Contents");
    return (Array.isArray(contents) ? contents : [contents])
      .map((c) => {
        const stream = doc.resolve(c);
        return isStream(stream) ? new TextDecoder("latin1").decode(doc.streamData(stream)) : "";
      })
      .join("\n");
  });
};

/** A logical page that overflows into `sheets` physical ones, footing each with its own counts. */
const section = (label: string, sheets: number) =>
  Page(
    {
      size: "A4",
      margin: 40,
      footer: PageBuilder(({ pageNumber, pageCount, subPageNumber, subPageTotalPages }) =>
        Text(`${label} ${subPageNumber}/${subPageTotalPages} - sheet ${pageNumber}/${pageCount}`, {
          size: 9,
        }),
      ),
    },
    [
      Column(
        Array.from({ length: sheets * 44 }, (_, i) => Text(`${label} line ${i}`, { size: 11 })),
      ),
    ],
  );

describe("a document of several logical pages", () => {
  it("restarts the sub count at each one while the sheet count runs on", async () => {
    const bytes = await renderToBytes(Document([section("Invoice", 2), section("Attachment", 2)]), {
      compress: false,
      kerning: false,
    });
    const pages = pageTexts(bytes);
    expect(pages.length).toBeGreaterThanOrEqual(4);

    // The first section's sheets are numbered 1..n within it, and the second section starts at 1 again
    // even though the sheet number keeps climbing.
    const feet = pages
      .map((p) => /(\w+) (\d+)\/(\d+) - sheet (\d+)\/(\d+)/.exec(p))
      .filter(Boolean);
    expect(feet.length).toBe(pages.length);

    const first = feet.filter((m) => m![1] === "Invoice");
    const second = feet.filter((m) => m![1] === "Attachment");
    expect(first.map((m) => m![2])).toEqual(first.map((_, i) => String(i + 1)));
    expect(second.map((m) => m![2])).toEqual(second.map((_, i) => String(i + 1)));

    // ... and the sheet numbers never restart.
    expect(feet.map((m) => Number(m![4]))).toEqual(feet.map((_, i) => i + 1));

    // Each section's total is its OWN, not the document's.
    expect(first.every((m) => Number(m![3]) === first.length)).toBe(true);
    expect(second.every((m) => Number(m![3]) === second.length)).toBe(true);
    expect(Number(first[0]![5])).toBe(pages.length); // the document total, on every page
  });
});

describe("a document of ONE logical page", () => {
  it("makes the two counts identical, so nothing surprises a single-section document", async () => {
    const bytes = await renderToBytes(Document([section("Report", 3)]), {
      compress: false,
      kerning: false,
    });
    for (const page of pageTexts(bytes)) {
      const m = /(\w+) (\d+)\/(\d+) - sheet (\d+)\/(\d+)/.exec(page);
      expect(m).not.toBeNull();
      expect(m![2]).toBe(m![4]); // subPageNumber === pageNumber
      expect(m![3]).toBe(m![5]); // subPageTotalPages === pageCount
    }
  });
});

describe("the sugar", () => {
  it("SubPageNumber and SubPageCount draw the same values", async () => {
    const bytes = await renderToBytes(
      Document([
        Page(
          {
            size: "A4",
            margin: 40,
            footer: Column([SubPageNumber({ size: 9 }), SubPageCount({ size: 9 })]),
          },
          [Column(Array.from({ length: 88 }, (_, i) => Text(`line ${i}`, { size: 11 })))],
        ),
      ]),
      { compress: false, kerning: false },
    );
    const pages = pageTexts(bytes);
    expect(pages.length).toBe(2);
    expect(pages[0]).toContain("(1)");
    expect(pages[1]).toContain("(2)");
    for (const p of pages) expect(p).toContain("(2)"); // the total, on both
  });
});

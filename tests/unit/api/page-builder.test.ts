import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Paragraph,
  Text,
  PageBuilder,
  PageNumber,
  PageCount,
  renderPdf,
} from "../../../src/lib/api";

// Enough body to flow across three physical pages.
const filler = () =>
  Array.from({ length: 14 }, () => Paragraph("Lorem ipsum dolor sit amet. ".repeat(30)));

// `compress: false` keeps the content stream greppable, so we can assert on the drawn text itself.
const drawn = (doc: Parameters<typeof renderPdf>[0]) => renderPdf(doc, { compress: false });

describe("PageBuilder / PageNumber / PageCount", () => {
  it("gives a footer the running page number and the final total", async () => {
    const doc = Document([
      Page(
        {
          footer: PageBuilder(({ pageNumber, pageCount }) => Text(`P${pageNumber}of${pageCount}`)),
        },
        [Column(filler())],
      ),
    ]);
    const pdf = await drawn(doc);

    // Three pages were produced, and each footer shows its own number with the same total.
    expect(pdf).toContain("(P1of3)");
    expect(pdf).toContain("(P2of3)");
    expect(pdf).toContain("(P3of3)");
    expect(pdf).toContain("/Count 3");
  });

  it("lets the closure branch on the page number", async () => {
    const doc = Document([
      Page(
        {
          header: PageBuilder(({ pageNumber }) =>
            pageNumber === 1 ? Text("FIRST") : Text("CONT"),
          ),
        },
        [Column(filler())],
      ),
    ]);
    const pdf = await drawn(doc);
    expect(pdf).toContain("(FIRST)");
    expect(pdf).toContain("(CONT)");
  });

  it("works in the body, not just header/footer", async () => {
    const doc = Document([Page([Column([Text("x"), PageNumber(), PageCount()])])]);
    const pdf = await drawn(doc);
    expect(pdf).toContain("(1)"); // single page: number and count are both 1
  });

  it("applies `offset` (a cover page that does not count)", async () => {
    const doc = Document([Page([Column([PageNumber({ offset: -1 }), PageCount({ offset: 10 })])])]);
    const pdf = await drawn(doc);
    expect(pdf).toContain("(0)"); // 1 + (-1)
    expect(pdf).toContain("(11)"); // 1 + 10
  });

  it("hands the closure the page size in points (A4 portrait)", async () => {
    const doc = Document([
      Page({ size: "A4" }, [
        Column([PageBuilder(({ pageSize }) => Text(`${pageSize.width}x${pageSize.height}`))]),
      ]),
    ]);
    const pdf = await drawn(doc);
    expect(pdf).toContain("(595.28x841.89)");
  });

  it("counts physical pages across several logical Pages", async () => {
    const doc = Document([
      Page({ footer: PageNumber() }, [Column([Text("a")])]),
      Page({ footer: PageCount() }, [Column([Text("b")])]),
    ]);
    const pdf = await drawn(doc);
    expect(pdf).toContain("(1)"); // first page's number
    expect(pdf).toContain("(2)"); // second page shows the total, which is 2
  });

  it("sees THIS page's geometry while it is being measured, not the document default", async () => {
    // The page is A5 (419.53 wide); the document default is A4 (595.28). Every build - including the
    // provisional one during pagination - must be handed the page's own size, never the document's.
    const seen = new Set<number>();
    const probe = () =>
      PageBuilder(({ pageSize }) => {
        seen.add(Math.round(pageSize.width));
        return Text("probe");
      });
    const doc = Document([
      Page({ size: "A5" }, [Column([probe(), ...filler()])]), // long enough to fragment
    ]);
    await drawn(doc);
    expect([...seen]).toEqual([420]); // A5 portrait, never 595 (A4)
  });

  it("adds nothing when no PageBuilder is used (unchanged output path)", async () => {
    const pdf = await drawn(Document([Page([Text("plain")])]));
    expect(pdf).toContain("/Count 1");
  });
});

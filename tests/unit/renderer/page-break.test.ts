import { describe, it, expect, vi } from "vitest";
import {
  Document,
  Page,
  Column,
  Row,
  Box,
  Text,
  PageBreak,
  renderToBytes,
} from "../../../src/lib/api";

// A forced page break: everything after it starts a fresh page, even when it would have fit. Nesting
// works because the `forceBreak` signal bubbles up through the fragment result.

const render = async (doc: Parameters<typeof renderToBytes>[0]) =>
  new TextDecoder("latin1").decode(await renderToBytes(doc, { compress: false, kerning: false }));

const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

// Which sentinel words appear in each drawn content stream, in order.
const wordsPerStream = (pdf: string, sentinels: string[]): string[][] =>
  [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map((m) => sentinels.filter((w) => m[1].includes(`(${w})`)))
    .filter((ws) => ws.length > 0);

describe("PageBreak", () => {
  it("starts everything after it on a new page, even when it would have fit", async () => {
    const pdf = await render(
      Document([Page({ margin: 40 }, [Column([Text("AAA"), PageBreak(), Text("BBB")])])]),
    );
    expect(pageCount(pdf)).toBe(2);
    expect(wordsPerStream(pdf, ["AAA", "BBB"])).toEqual([["AAA"], ["BBB"]]);
  });

  it("honours a break nested inside a box, and carries later siblings with it", async () => {
    // AAA and the break live inside a Box; CCC is a sibling AFTER the box. The break must cut so that
    // BBB (after the break, inside the box) and CCC (after the box) both move to page 2.
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column([
            Box({ bg: "#eef" }, [Column([Text("AAA"), PageBreak(), Text("BBB")])]),
            Text("CCC"),
          ]),
        ]),
      ]),
    );
    expect(pageCount(pdf)).toBe(2);
    expect(wordsPerStream(pdf, ["AAA", "BBB", "CCC"])).toEqual([["AAA"], ["BBB", "CCC"]]);
  });

  it("a document with no break is a single page (the packer is unchanged)", async () => {
    const pdf = await render(Document([Page({ margin: 40 }, [Column([Text("only one")])])]));
    expect(pageCount(pdf)).toBe(1);
  });

  it("a trailing break with nothing after it does not add a blank page", async () => {
    const pdf = await render(
      Document([Page({ margin: 40 }, [Column([Text("AAA"), PageBreak()])])]),
    );
    expect(pageCount(pdf)).toBe(1);
  });

  it("two breaks in a row make three pages", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column([Text("AAA"), PageBreak(), Text("BBB"), PageBreak(), Text("CCC")]),
        ]),
      ]),
    );
    expect(pageCount(pdf)).toBe(3);
    expect(wordsPerStream(pdf, ["AAA", "BBB", "CCC"])).toEqual([["AAA"], ["BBB"], ["CCC"]]);
  });

  it("a break inside a Row has no effect and warns (a row is one horizontal line)", async () => {
    // CSS and react-pdf both ignore a forced break here (measured: react-pdf 4.6 renders 1 page too).
    // We match that - the break draws nothing - but warn once so the mistake is not silent.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column([Row([Text("LEFT"), PageBreak(), Text("RIGHT")]), Text("AFTER")]),
        ]),
      ]),
    );
    expect(pageCount(pdf)).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/PageBreak had no effect/);
    warn.mockRestore();
  });

  it("a trailing break inside a Box does not warn or add a page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [Column([Box({ bg: "#eef" }, [Column([Text("AAA"), PageBreak()])])])]),
      ]),
    );
    expect(pageCount(pdf)).toBe(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("an effective break does not warn", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(
      Document([Page({ margin: 40 }, [Column([Text("AAA"), PageBreak(), Text("BBB")])])]),
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

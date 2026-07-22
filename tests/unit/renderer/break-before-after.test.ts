import { describe, it, expect, vi } from "vitest";
import { Document, Page, Column, Box, Text, renderToBytes } from "../../../src/lib/api";

// `breakBefore` / `breakAfter` props (CSS `break-before`/`break-after: page`, react-pdf's `break`).
// The parent packer reads the flag at the child boundary - no standalone marker element involved.

const render = async (doc: Parameters<typeof renderToBytes>[0]) =>
  new TextDecoder("latin1").decode(await renderToBytes(doc, { compress: false, kerning: false }));

const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

const wordsPerStream = (pdf: string, sentinels: string[]): string[][] =>
  [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .map((m) => sentinels.filter((w) => m[1].includes(`(${w})`)))
    .filter((ws) => ws.length > 0);

describe("breakBefore / breakAfter", () => {
  it("breakBefore starts the box (and everything after) on a fresh page", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column([Text("AAA"), Box({ breakBefore: true, bg: "#eef" }, [Text("BBB")]), Text("CCC")]),
        ]),
      ]),
    );
    expect(pageCount(pdf)).toBe(2);
    expect(wordsPerStream(pdf, ["AAA", "BBB", "CCC"])).toEqual([["AAA"], ["BBB", "CCC"]]);
  });

  it("breakAfter starts everything after the box on a fresh page", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column([Box({ breakAfter: true, bg: "#eef" }, [Text("AAA")]), Text("BBB")]),
        ]),
      ]),
    );
    expect(pageCount(pdf)).toBe(2);
    expect(wordsPerStream(pdf, ["AAA", "BBB"])).toEqual([["AAA"], ["BBB"]]);
  });

  it("breakBefore at the top of a page is ignored (no empty page, CSS behaviour)", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column([Box({ breakBefore: true, bg: "#eef" }, [Text("AAA")]), Text("BBB")]),
        ]),
      ]),
    );
    expect(pageCount(pdf)).toBe(1);
  });

  it("breakBefore works on a Column section too", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [Column([Text("AAA"), Column({ breakBefore: true }, [Text("BBB")])])]),
      ]),
    );
    expect(pageCount(pdf)).toBe(2);
    expect(wordsPerStream(pdf, ["AAA", "BBB"])).toEqual([["AAA"], ["BBB"]]);
  });

  it("a breakBefore nested deep inside a box is honoured (the signal bubbles up)", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column([
            Box({ bg: "#eef" }, [Column([Text("AAA"), Box({ breakBefore: true }, [Text("BBB")])])]),
            Text("CCC"),
          ]),
        ]),
      ]),
    );
    expect(pageCount(pdf)).toBe(2);
    // AAA stays; BBB (the break-before box, still inside the outer box) and CCC (after the box) move.
    expect(wordsPerStream(pdf, ["AAA", "BBB", "CCC"])).toEqual([["AAA"], ["BBB", "CCC"]]);
  });

  it("an effective break-before does not warn (it is consumed, not orphaned)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render(
      Document([
        Page({ margin: 40 }, [Column([Text("AAA"), Box({ breakBefore: true }, [Text("BBB")])])]),
      ]),
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

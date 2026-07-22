import { describe, it, expect, vi } from "vitest";
import {
  Document,
  Page,
  Column,
  Text,
  PageBreak,
  keepTogether,
  renderToBytes,
} from "../../../src/lib/api";

// keepTogether (CSS `break-inside: avoid`): a group that would straddle a page boundary moves whole to
// the next page; a group taller than a whole page splits anyway, so pagination always terminates.

const render = async (doc: Parameters<typeof renderToBytes>[0]) =>
  new TextDecoder("latin1").decode(await renderToBytes(doc, { compress: false, kerning: false }));

const pageCount = (pdf: string) => (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

// 1-based index of the content stream (≈ physical page) a sentinel word is drawn on.
const pageOf = (pdf: string, word: string): number =>
  [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)].findIndex((m) => m[1].includes(`(${word})`)) +
  1;

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => Text(`filler ${i + 1}`, { size: 12 }));
// A group tuned to STRADDLE the boundary after `fillerCount` filler lines on an A4 body.
const group = () => [Text("GTOP", { size: 12 }), ...lines(6), Text("GBOT", { size: 12 })];
const fillerCount = 42;

describe("keepTogether", () => {
  it("moves a group that would straddle the boundary whole to the next page", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [Column({ gap: 2 }, [...lines(fillerCount), keepTogether(group())])]),
      ]),
    );
    // The whole group lands together on page 2 (top and bottom on the same page).
    expect(pageOf(pdf, "GTOP")).toBe(pageOf(pdf, "GBOT"));
    expect(pageOf(pdf, "GTOP")).toBe(2);
  });

  it("WITHOUT keepTogether the same group splits across the boundary (the control)", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [
          Column({ gap: 2 }, [...lines(fillerCount), Column({ gap: 2 }, group())]),
        ]),
      ]),
    );
    // Top on page 1, bottom on page 2: it straddled. This is what keepTogether prevents.
    expect(pageOf(pdf, "GTOP")).toBe(1);
    expect(pageOf(pdf, "GBOT")).toBe(2);
  });

  it("splits a group taller than a whole page (degrade, so pagination terminates)", async () => {
    const pdf = await render(
      Document([Page({ margin: 40 }, [Column({ gap: 2 }, [keepTogether(lines(120))])])]),
    );
    expect(pageCount(pdf)).toBeGreaterThan(1);
    expect(pageCount(pdf)).toBeLessThan(6); // finite, no runaway
  });

  it("a forced break inside a keepTogether wins, and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [Column([keepTogether([Text("AAA"), PageBreak(), Text("BBB")])])]),
      ]),
    );
    expect(pageCount(pdf)).toBe(2); // the break wins
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/keepTogether contains a forced page break/);
    warn.mockRestore();
  });

  it("nested keepTogethers still apply when an outer one degrades (outer->inner)", async () => {
    // The outer group is taller than a page, so it must split; an inner keepTogether small enough to fit
    // should still be kept whole rather than split at the boundary.
    const inner = keepTogether([
      Text("ITOP", { size: 12 }),
      ...lines(6),
      Text("IBOT", { size: 12 }),
    ]);
    const pdf = await render(
      Document([
        Page({ margin: 40 }, [Column({ gap: 2 }, [keepTogether([...lines(fillerCount), inner])])]),
      ]),
    );
    expect(pageOf(pdf, "ITOP")).toBe(pageOf(pdf, "IBOT")); // inner stayed together
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Row,
  Box,
  Text,
  Paragraph,
  Table,
  DefaultTextStyle,
  PageNumber,
  renderToBytes,
} from "../../../src/lib/index.ts";
import type { JasyDocument } from "../../../src/lib/api/structure.ts";
import { deeplyNested } from "../support/deep-nesting.ts";
import { layoutCache } from "../../../src/lib/layout/layout-cache.ts";

// The output of a fixed set of documents, pinned to the byte. Output is byte-stable (no dates, a
// content-hash /ID), so ANY change to layout - a moved line, a word wrapped elsewhere, a page split
// differently - changes a hash here and fails at once. The documents aim at what a layout or text
// cache could get wrong: the same element laid out at two widths, inherited styles, text split
// across pages, bands repeated per page, fallback fonts.
//
// A deliberate output change updates the hashes, with the reason in the commit.

const font = readFileSync(new URL("../../fixtures/fonts/dejavu-subset.ttf", import.meta.url));

const words = (n: number, seed: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      ["layout", "measure", "page", "wrap", "invoice", "line", "box", "text"][(i * 7 + seed) % 8],
  ).join(" ");

// The real German patterns, as the docs recommend (a devDependency; jasy ships none).
const { hyphenateSync } = createRequire(import.meta.url)("hyphen/de") as {
  hyphenateSync: (w: string) => string;
};
const german = (word: string): string[] => hyphenateSync(word).split("\u00AD");

const documents: Record<string, () => JasyDocument> = {
  // The same Text measured in a Row that then shrinks it: two widths, two different wraps.
  "a text shrunk by its row": () =>
    Document([
      Page({ size: "A6", margin: 20 }, [
        Row({ gap: 6 }, [
          Text(words(30, 1)),
          Box({ width: 120, border: "black" }, [Text("fixed")]),
        ]),
      ]),
    ]),
  // The same words in three widths, each followed by a marker: a measurement reused across widths
  // gives all three one height, and every marker below moves.
  "the same words in three widths": () =>
    Document([
      Page({ size: "A6", margin: 20 }, [
        Box({ width: 60 }, [Text(words(12, 0))]),
        Text("after the narrow one"),
        Box({ width: 140 }, [Text(words(12, 0))]),
        Text("after the middle one"),
        Text(words(12, 0)),
        Text("after the full width"),
      ]),
    ]),
  // Eight levels of Column / Box / Row: the shape whose layout cost grew 2^depth.
  "deep nesting": () => Document([Page({ size: "A3", margin: 20 }, deeplyNested(8))]),
  // A wrapping Row: chips flow onto as many lines as they need.
  "a wrapping row": () =>
    Document([
      Page({ size: "A6", margin: 20 }, [
        Row(
          { wrap: true, gap: 4 },
          Array.from({ length: 24 }, (_, i) =>
            Box({ padding: 3, border: "gray" }, [Text(words(1 + (i % 3), i))]),
          ),
        ),
      ]),
    ]),
  // Paragraphs that cross a page break: split at line boxes, orphans and widows.
  "paragraphs across pages": () =>
    Document([
      Page({ size: "A6", margin: 20 }, [
        Column(
          { gap: 6 },
          Array.from({ length: 14 }, (_, i) => Paragraph(words(40, i))),
        ),
      ]),
    ]),
  // Styles inherited from the document and from a DefaultTextStyle - the same words, three looks.
  "inherited text styles": () =>
    Document({ size: 13, lineHeight: 1.4 }, [
      Page({ size: "A6", margin: 20 }, [
        Text(words(18, 2)),
        DefaultTextStyle({ size: 8, bold: true }, [Text(words(18, 2))]),
        Text(words(18, 2), { size: 10, italic: true }),
      ]),
    ]),
  // A header and footer laid out again on every page, with the page number.
  "bands on every page": () =>
    Document([
      Page(
        {
          size: "A6",
          margin: 20,
          header: Text("Header with a title long enough to wrap in a narrow band"),
          footer: Row({}, [Text("Footer"), PageNumber()]),
        },
        Array.from({ length: 30 }, (_, i) => Text(words(12, i))),
      ),
    ]),
  // Line limits, ellipsis, justification, spacing, indent, a transform and hyphenation.
  "text options": () =>
    Document([
      Page({ size: "A6", margin: 20 }, [
        Text(words(60, 3), { maxLines: 2, overflow: "ellipsis" }),
        Text(words(60, 4), { align: "justify", letterSpacing: 0.4, textIndent: 12 }),
        Text(words(30, 5), { textTransform: "uppercase", wordSpacing: 2 }),
        // Narrow on purpose: the long words must not fit, or neither option is ever exercised.
        Box({ width: 70 }, [
          Text("Rechnungsnummernvergabe und Leistungszeitraumbestimmung", {
            hyphenate: german,
          }),
          Text("IBAN DE02120300000000202051 INV-MRHG2EXG-2026/012-SD", { breakWord: true }),
        ]),
      ]),
    ]),
  // An embedded font, a font stack that falls back per code point, and right-to-left text.
  "fonts, fallback and direction": () =>
    Document([
      Page({ size: "A6", margin: 20 }, [
        // The fixture font holds only the glyphs of "Waffel fjord VAV 0123".
        Text("Waffel fjord VAV 0123 Waffel fjord VAV 0123 Waffel fjord VAV 0123", { font: "Test" }),
        // Every code point the first family lacks falls back to the second: a switch mid-word.
        Text("Waffel fjord meets plain words that wrap Waffel 0123 sixty", {
          font: ["Test", "Helvetica"],
        }),
        Text(words(20, 7), { direction: "rtl" }),
      ]),
    ]),
  // A table with a measured column and a repeating header across pages.
  "a measured table across pages": () =>
    Document([
      Page({ size: "A6", margin: 20 }, [
        Table(
          {
            columns: ["minmax(30, auto)", "1fr", "auto"],
            header: ["No", "Item", "Sum"],
            cellBorder: "gray",
          },
          Array.from({ length: 40 }, (_, i) => [`10.${i}`, words(8, i), `${i}.00`]),
        ),
      ]),
    ]),
  // The two benchmark shapes: many boxes, and many flowing paragraphs.
  "many boxes": () =>
    Document({ size: 8 }, [
      Page(
        { margin: 30, gap: 4 },
        Array.from({ length: 20 }, (_, r) =>
          Row(
            { gap: 4 },
            Array.from({ length: 6 }, (_, c) =>
              Box(
                { width: 80, height: 16, bg: "#dbe6f8", border: "#8fa5c8", radius: 3, padding: 2 },
                [Text(`${r}.${c}`)],
              ),
            ),
          ),
        ),
      ),
    ]),
  "many paragraphs": () =>
    Document({ size: 11, lineHeight: 1.1 }, [
      Page({ margin: 40 }, [
        Column(
          { gap: 6 },
          Array.from({ length: 60 }, (_, i) => Paragraph(words(60, i))),
        ),
      ]),
    ]),
};

/** Fonts a document needs registered at render time. */
const FONTS: Record<string, Record<string, Buffer>> = {
  "fonts, fallback and direction": { Test: font },
};

const fingerprint = async (make: () => JasyDocument, fonts?: Record<string, Buffer>) =>
  createHash("sha256")
    .update(await renderToBytes(make(), { fonts }))
    .digest("hex")
    .slice(0, 16);

const EXPECTED: Record<string, string> = {
  "deep nesting": "633ca2c81de7aeb5",
  "a wrapping row": "b5cdb47c10542bca",
  "a text shrunk by its row": "bc99bf7e05ea2d27",
  "the same words in three widths": "f5816a1e5006ddbf",
  "paragraphs across pages": "c4ac3647040a72be",
  "inherited text styles": "7156d960178eb6c5",
  "bands on every page": "965fba41b58298ff",
  "text options": "bd72f6c715864607",
  "fonts, fallback and direction": "548533f2338052bf",
  "a measured table across pages": "d6d10f1917879e0f",
  "many boxes": "89d9730dea6f0d0c",
  "many paragraphs": "22f6801b2554d620",
};

describe("the layout of a fixed set of documents is pinned to the byte", () => {
  it.each(Object.keys(documents))("%s", async (name) => {
    expect(await fingerprint(documents[name]!, FONTS[name])).toBe(EXPECTED[name]);
  });

  it("is not vacuous: one changed word changes the fingerprint", async () => {
    const one = () => Document([Page([Text("one word")])]);
    const other = () => Document([Page([Text("one ward")])]);
    expect(await fingerprint(one)).not.toBe(await fingerprint(other));
  });
});

describe("the layout cache changes nothing", () => {
  // The hashes above pin today's output; this keeps proving it after a deliberate change to them.
  it.each(Object.keys(documents))("%s", async (name) => {
    const render = () => renderToBytes(documents[name]!(), { fonts: FONTS[name] });
    let without: Uint8Array;
    layoutCache.enabled = false;
    try {
      without = await render();
    } finally {
      layoutCache.enabled = true;
    }
    expect(Buffer.from(await render()).equals(Buffer.from(without))).toBe(true);
  });
});

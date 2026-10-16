import { describe, it, expect } from "vitest";
import {
  breakSegmentsIntoLines,
  breakStringIntoLines,
  wrapStringIntoLines,
  type BrokenLine,
} from "../../../src/lib/text/line-breaker.ts";
import type { TextSegment } from "../../../src/lib/elements/text-element.ts";
import { HYPHEN } from "../../../src/lib/text/word-splitting.ts";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// A broken line knows where it starts in the source and how it ends. A paragraph split across pages
// continues from that position - so it has to be exact for every kind of break.

const metrics = testMetrics(); // every glyph 10pt at size 10, a space is free
const chunks = (size: number) => (word: string) =>
  word.match(new RegExp(`.{1,${size}}`, "g")) ?? [word];

const breakAt = (text: string, width: number, splitting = {}) =>
  breakStringIntoLines(
    text,
    "Helvetica",
    10,
    FontStyle.Normal,
    width,
    metrics,
    undefined,
    undefined,
    0,
    {
      splitting,
    },
  );

/** The line's own characters as the source holds them: without a hyphen the breaker added. */
const sourceOf = (line: BrokenLine) =>
  line.end === "hyphen" ? line.text.slice(0, -HYPHEN.length) : line.text;

const cases: [string, string, number, object][] = [
  ["plain words", "alpha beta gamma delta epsilon zeta eta theta iota kappa", 120, {}],
  ["hard breaks", "first line\nsecond line\n\nafter a blank line", 300, {}],
  ["double spaces", "a  b   c    d", 30, {}],
  ["break-word", "averyveryverylongwordwithoutanyspace and more", 80, { breakWord: true }],
  ["hyphenation", "aaaabbbbccccdddd eeee ffffgggghhhh", 60, { hyphenate: chunks(4) }],
  [
    "everything",
    "one\ntwo threefourfivesix seven\n\neight",
    50,
    { hyphenate: chunks(3), breakWord: true },
  ],
];

describe.each(cases)("line starts: %s", (_name, text, width, splitting) => {
  const lines = breakAt(text, width, splitting);

  it("draws exactly the lines wrapStringIntoLines draws", () => {
    expect(lines.map((l) => l.text)).toEqual(
      wrapStringIntoLines(
        text,
        "Helvetica",
        10,
        FontStyle.Normal,
        width,
        metrics,
        undefined,
        undefined,
        0,
        {
          splitting,
        },
      ),
    );
  });

  it("finds every line in the source at its start", () => {
    for (const line of lines) expect(text.startsWith(sourceOf(line), line.start)).toBe(true);
  });

  it("starts are in order, and what lies between two starts is the earlier line plus separators", () => {
    for (let i = 1; i < lines.length; i++) {
      const between = text.slice(lines[i - 1]!.start, lines[i]!.start);
      expect(lines[i]!.start).toBeGreaterThanOrEqual(lines[i - 1]!.start);
      // Only the line itself and spaces / one newline separate it from the next line.
      expect(between.startsWith(sourceOf(lines[i - 1]!))).toBe(true);
      expect(/^[ \n]*$/.test(between.slice(sourceOf(lines[i - 1]!).length))).toBe(true);
    }
  });
});

describe("how a line ends", () => {
  it("a \\n is hard, a wrap is soft, the last line is the end", () => {
    const ends = breakAt("one two\nthree four five six", 100).map((l) => l.end);
    expect(ends[0]).toBe("hard");
    expect(ends.slice(1, -1).every((e) => e === "soft")).toBe(true);
    expect(ends[ends.length - 1]).toBe("end");
  });

  it("a hyphenated piece ends in a hyphen, a break-word piece is a plain split", () => {
    expect(breakAt("aaaabbbbcccc", 60, { hyphenate: chunks(4) }).map((l) => l.end)).toEqual([
      "hyphen",
      "hyphen",
      "end",
    ]);
    expect(breakAt("abcdefghijkl", 50, { breakWord: true }).map((l) => l.end)).toEqual([
      "split",
      "split",
      "end",
    ]);
  });
});

// The same for span text: a line starts at a span and an offset in that span's content.
describe("span line starts", () => {
  const spans: [string, TextSegment[], number, object][] = [
    [
      "words over spans",
      [{ content: "alpha beta " }, { content: "gamma delta epsilon" }, { content: " zeta eta" }],
      100,
      {},
    ],
    [
      "hard breaks in a span",
      [{ content: "one two\nthree" }, { content: " four five\nsix" }],
      300,
      {},
    ],
    [
      "hyphenation in a span",
      [{ content: "aaaabbbbcccc " }, { content: "ddddeeee ff" }],
      60,
      { hyphenate: chunks(4) },
    ],
  ];
  it.each(spans)(
    "%s: every line is found in its span at its start",
    (_name, content, width, splitting) => {
      const lines = breakSegmentsIntoLines(
        content,
        { fontFamily: "Helvetica", fontSize: 10, fontStyle: FontStyle.Normal, splitting },
        width,
        metrics,
      );
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) {
        // The line's first non-empty piece, as the source holds it (no added hyphen).
        const first = line.segments.find((seg) => seg.content !== "")!;
        const own =
          line.end === "hyphen" && line.segments.length === 1
            ? first.content.slice(0, -HYPHEN.length)
            : first.content;
        const source = content[line.start.segment]!.content;
        expect(source.startsWith(own, line.start.offset)).toBe(true);
      }
    },
  );
});

// A soft hyphen (U+00AD, `&shy;` from a CMS) is already a break point in the source. A hyphenator may
// drop it (`hyphenateSync(w).split("­")` does), so the drawn pieces are shorter than the source
// they cover: a start counted from the drawn length lands one character early per soft hyphen.
describe("line starts with soft hyphens in the source", () => {
  const SHY = "­";
  const atSoftHyphens = (word: string) => word.split(SHY);
  const plain = (s: string) => s.replaceAll(SHY, "");
  const word = ["aaaa", "bbbb", "cccc", "dddd"].join(SHY);

  it("a plain string: every line starts at its own text, never on a soft hyphen", () => {
    const text = `${word} ${word}`;
    const lines = breakAt(text, 60, { hyphenate: atSoftHyphens });
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(text[line.start]).not.toBe(SHY);
      expect(plain(text.slice(line.start)).startsWith(plain(sourceOf(line)))).toBe(true);
    }
  });

  it("span text: the same", () => {
    const content: TextSegment[] = [{ content: `${word} ` }, { content: word }];
    const lines = breakSegmentsIntoLines(
      content,
      {
        fontFamily: "Helvetica",
        fontSize: 10,
        fontStyle: FontStyle.Normal,
        splitting: { hyphenate: atSoftHyphens },
      },
      60,
      metrics,
    );
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      const first = line.segments.find((seg) => seg.content !== "")!;
      const own = line.end === "hyphen" ? first.content.slice(0, -HYPHEN.length) : first.content;
      const source = content[line.start.segment]!.content;
      expect(source[line.start.offset]).not.toBe(SHY);
      expect(plain(source.slice(line.start.offset)).startsWith(plain(own))).toBe(true);
    }
  });

  it("a hyphenator that returns text other than the word does not split it", () => {
    const lines = breakAt("aaaabbbbcccc", 60, { hyphenate: () => ["xxxx", "yyyy"] });
    expect(lines.map((l) => l.text)).toEqual(["aaaabbbbcccc"]);
  });
});

// A space that does not fit hangs past the edge, as in CSS. Closing the line on it ended the paragraph's
// real last line "soft" - stretched when justified - and pushed a blank line before a `\n`.
describe("a trailing space that does not fit", () => {
  const om = new PDFObjectManager(); // real metrics: a space has a width
  om.registerFont("Helvetica");
  const width = om.getStringWidth("ab cd", "Helvetica", 10, FontStyle.Normal) + 0.5;
  const ends = (text: string) => ({
    string: breakStringIntoLines(text, "Helvetica", 10, FontStyle.Normal, width, om).map(
      (l) => `${l.text}:${l.end}`,
    ),
    spans: breakSegmentsIntoLines(
      text.split(/(?<= )/).map((content) => ({ content })),
      { fontFamily: "Helvetica", fontSize: 10, fontStyle: FontStyle.Normal },
      width,
      om,
    ).map(
      (l) =>
        `${l.segments
          .map((s) => s.content)
          .join("")
          .trim()}:${l.end}`,
    ),
  });

  it("at the end of the text: the last line ends the paragraph", () => {
    expect(ends("ab cd ")).toEqual({ string: ["ab cd:end"], spans: ["ab cd:end"] });
  });

  it("before a hard break: no blank line, the line ends hard", () => {
    expect(ends("ab cd \nef")).toEqual({
      string: ["ab cd:hard", "ef:end"],
      spans: ["ab cd:hard", "ef:end"],
    });
  });
});

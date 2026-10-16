import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Row,
  Box,
  Text,
  Paragraph,
  Expanded,
  Link,
  Anchor,
  Bookmark,
  Rotated,
  PageBreak,
  renderToBytes,
} from "../../../../src/lib/index.ts";
import { StructGroup } from "../../../../src/lib/elements/layout/struct-group.ts";
import { RepeatingHeaderElement } from "../../../../src/lib/elements/layout/repeating-header-element.ts";
import { DefaultTextStyleElement } from "../../../../src/lib/elements/layout/default-text-style-element.ts";
import type { PDFElement } from "../../../../src/lib/elements/pdf-element.ts";
import type { IRNode } from "../../../../src/lib/ir/display-list.ts";
import { drawnNodes } from "../../support/drawn.ts";

// A wrapper that only marks its child (a link, a jump target, an outline entry, a role, text
// defaults) must not change how the child is sized or broken across pages.

const wrappers: [string, (child: PDFElement) => PDFElement][] = [
  ["Link", (c) => Link({ href: "https://jasy.dev" }, c)],
  ["Anchor", (c) => Anchor({ name: "target" }, c)],
  ["Bookmark", (c) => Bookmark({ title: "Chapter" }, c)],
  // The element itself: the `DefaultTextStyle()` factory stacks its children in a Column first.
  ["DefaultTextStyle", (c) => new DefaultTextStyleElement({ style: { fontSize: 9 }, child: c })],
  ["StructGroup", (c) => new StructGroup({ role: "Sect", child: c })],
];

const render = (content: PDFElement[]) =>
  drawnNodes(() =>
    renderToBytes(Document([Page({ size: "A6", margin: 20 }, [Column({}, content)])]), {
      onOverflow: "error",
    }),
  );
const textsOn = (page: IRNode[]) => page.flatMap((n) => (n.type === "text" ? [n.text] : []));
const count = (pages: IRNode[][], type: IRNode["type"]) =>
  pages.map((p) => p.filter((n) => n.type === type).length);

const LINE = "A paragraph long enough to take two or three lines on a small page.";
const section = (n: number) =>
  Column(
    {},
    Array.from({ length: n }, (_, i) => Paragraph(`Paragraph ${i + 1}. ${LINE}`, { size: 9 })),
  );

describe.each(wrappers)("%s passes its child's signals on", (_name, wrap) => {
  it("a PageBreak inside it starts a new page", async () => {
    const pages = await render([wrap(Column({}, [Text("before"), PageBreak(), Text("after")]))]);
    expect(pages.map(textsOn)).toEqual([["before"], ["after"]]);
  });

  it("a PageBreak at its END moves what follows it to a new page", async () => {
    const pages = await render([wrap(Column({}, [Text("inside"), PageBreak()])), Text("next")]);
    expect(pages.map(textsOn)).toEqual([["inside"], ["next"]]);
  });

  it("long content inside it flows over pages, nothing cut off", async () => {
    // onOverflow "error": a wrapper that could not split would be placed whole and throw.
    const pages = await render([wrap(section(30))]);
    expect(pages.length).toBeGreaterThan(1);
    const drawn = pages.flatMap(textsOn).join(" ");
    for (let i = 1; i <= 30; i++) expect(drawn).toContain(`Paragraph ${i}.`);
  });

  it("a percentage size inside it resolves against the box around it", async () => {
    const pages = await render([
      Box({ height: 100 }, [wrap(Box({ height: "50%", bg: "#dbe6f8" }, []))]),
    ]);
    const filled = pages[0]!.find((n) => n.type === "rect" && n.fill !== undefined);
    expect(filled && filled.type === "rect" ? filled.height : 0).toBe(50);
  });
});

describe("a split wrapper marks its place once, and links stay clickable", () => {
  it("an Anchor split over two pages is ONE jump target, on the first", async () => {
    const pages = await render([Anchor({ name: "target" }, section(30))]);
    expect(count(pages, "anchor")).toEqual([1, ...pages.slice(1).map(() => 0)]);
  });

  it("a Bookmark split over two pages is ONE outline entry, on the first", async () => {
    const pages = await render([Bookmark({ title: "Chapter" }, section(30))]);
    expect(count(pages, "outline")).toEqual([1, ...pages.slice(1).map(() => 0)]);
  });

  it("a Link split over two pages is clickable on every page", async () => {
    const pages = await render([Link({ href: "https://jasy.dev" }, section(30))]);
    expect(count(pages, "link").every((n) => n === 1)).toBe(true);
  });
});

describe("wrappers that are not plain proxies", () => {
  it("an Expanded passes on a PageBreak inside it", async () => {
    const pages = await render([
      Text("first"),
      Expanded(Column({}, [Text("before"), PageBreak(), Text("after")])),
    ]);
    expect(pages.map(textsOn)).toEqual([["first", "before"], ["after"]]);
  });

  it("a repeating header passes on a PageBreak in its body, and repeats on the next page", async () => {
    const pages = await render([
      new RepeatingHeaderElement(Text("HEAD"), Column({}, [Text("a"), PageBreak(), Text("b")])),
    ]);
    expect(pages.map(textsOn)).toEqual([
      ["HEAD", "a"],
      ["HEAD", "b"],
    ]);
  });

  it("a repeating header with a PageBreak at the END of its body moves what follows", async () => {
    const pages = await render([
      new RepeatingHeaderElement(Text("HEAD"), Column({}, [Text("a"), PageBreak()])),
      Text("next"),
    ]);
    expect(pages.map(textsOn)).toEqual([["HEAD", "a"], ["next"]]);
  });

  it("a Rotated box passes on a break-before of its child", async () => {
    const pages = await render([
      Text("first"),
      Rotated({ angle: 5 }, Box({ breakBefore: true }, [Text("turned")])),
    ]);
    expect(pages.map(textsOn)).toEqual([["first"], ["turned"]]);
  });
});

// To a surrounding Row or Column a marking wrapper is not there (CSS `display: contents`): the flex
// properties of what it wraps count, and a value set on the wrapper itself wins.
describe("flex properties through a wrapper", () => {
  const link = (child: PDFElement) => Link({ href: "https://jasy.dev" }, child);
  const boxes = async (content: PDFElement[]) =>
    (await render(content))[0]!.flatMap((n) => (n.type === "rect" && n.fill ? [n] : []));

  it("an Expanded inside a Link fills the rest of a Row", async () => {
    const [fixed, grown] = await boxes([
      Row({}, [
        Box({ width: 60, height: 10, bg: "#eeeeee" }, []),
        link(Expanded(Box({ height: 10, bg: "#dbe6f8" }, []))),
      ]),
    ]);
    // A6 is 297.64pt wide, 20pt margins: 257.64 for the row, 60 of it fixed.
    expect(fixed!.width).toBe(60);
    expect(grown!.width).toBeCloseTo(257.64 - 60, 6);
  });

  it("an Expanded inside a Link fills the rest of a Column of fixed height", async () => {
    const [grown] = await boxes([
      Column({ height: 100 }, [Text("top"), link(Expanded(Box({ bg: "#dbe6f8" }, [])))]),
    ]);
    expect(grown!.height).toBeGreaterThan(80);
  });

  it("alignSelf on a box inside a Link places it", async () => {
    const [start, end] = await boxes([
      Row({ height: 60, align: "start" }, [
        Box({ width: 20, height: 10, bg: "#eeeeee" }, []),
        link(Box({ width: 20, height: 10, bg: "#dbe6f8", alignSelf: "end" }, [])),
      ]),
    ]);
    expect(end!.y - start!.y).toBe(50);
  });

  it("order on a box inside a Link moves it", async () => {
    const drawn = await boxes([
      Row({}, [
        Box({ width: 20, height: 10, bg: "#eeeeee" }, []),
        link(Box({ width: 20, height: 10, bg: "#dbe6f8", order: -1 }, [])),
      ]),
    ]);
    const blue = drawn.find((r) => r.x === Math.min(...drawn.map((d) => d.x)));
    expect(
      blue && blue.fill && "toPDFColorString" in blue.fill ? blue.fill.toPDFColorString() : "",
    ).toBe("0.859 0.902 0.973");
  });

  it("flexShrink 0 inside a Link keeps the box at its size in an overflowing Row", async () => {
    const drawn = await boxes([
      Row({}, [
        Box({ width: 200, height: 10, bg: "#eeeeee" }, []),
        link(Box({ width: 200, height: 10, bg: "#dbe6f8", flexShrink: 0 }, [])),
      ]),
    ]);
    expect(drawn.map((r) => r.width)).toEqual([257.64 - 200, 200]);
  });

  it("a value set on the wrapper itself wins over the one inside", async () => {
    const outer = link(Box({ width: 20, height: 10, bg: "#dbe6f8", alignSelf: "end" }, []));
    outer.withAlignSelf("center");
    const [, centred] = await boxes([
      Row({ height: 60, align: "start" }, [
        Box({ width: 20, height: 10, bg: "#eeeeee" }, []),
        outer,
      ]),
    ]);
    expect(centred!.y - 20).toBe(25);
  });

  it("an Expanded may not hold another Expanded, wrapper or not", async () => {
    await expect(
      renderToBytes(Document([Page({}, [Row({}, [Expanded(link(Expanded(Text("x"))))])])])),
    ).rejects.toThrow(/cannot hold another flexible element/);
  });
});

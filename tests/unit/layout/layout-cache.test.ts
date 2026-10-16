import { describe, it, expect, afterEach } from "vitest";
import { PDFElement, type LayoutContext } from "../../../src/lib/elements/pdf-element.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element.ts";
import { PageBuilderElement } from "../../../src/lib/elements/layout/page-builder-element.ts";
import { BoxConstraints, type Offset, type Size } from "../../../src/lib/layout/box-constraints.ts";
import { BuiltFromContext, layoutCache } from "../../../src/lib/layout/layout-cache.ts";
import { DEFAULT_TEXT_STYLE, mergeTextStyle } from "../../../src/lib/text/text-style.ts";
import { PageSize } from "../../../src/lib/constants/page-sizes.ts";
import type { PageInfo } from "../../../src/lib/elements/pdf-element.ts";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics.ts";
import { testMetrics } from "../support/metrics.ts";

// Every input a size depends on is part of the cache key. Each test changes exactly ONE of them and
// demands a fresh answer - drop that field from the key and its test fails.

const metrics = testMetrics();
// One fixed context; each test replaces exactly one field. (Context values compare by identity, so a
// fresh object per call would miss on THAT field and hide whether the one under test is keyed.)
const A4 = { pageSize: PageSize.A4 };
const ctx = (over: Partial<LayoutContext> = {}): LayoutContext => ({
  metrics,
  pageConfig: A4,
  textStyle: DEFAULT_TEXT_STYLE,
  ...over,
});
const loose = (w: number) => BoxConstraints.loose(w, Infinity);

class Counted extends PDFElement {
  computed = 0;
  getProps(): unknown {
    return {};
  }
  calculateLayout(c: BoxConstraints, _o: Offset, context: LayoutContext): Size {
    return this.measure(c, context);
  }
  protected computeSize(c: BoxConstraints): Size {
    this.computed++;
    return { width: Number.isFinite(c.maxWidth) ? c.maxWidth : 7, height: 3 };
  }
}

afterEach(() => {
  layoutCache.enabled = true;
});

describe("the layout cache", () => {
  it("answers the same question again without computing", () => {
    const el = new Counted();
    const c = ctx();
    el.measure(loose(100), c);
    el.measure(loose(100), c);
    expect(el.computed).toBe(1);
  });

  it("computes every time when switched off", () => {
    layoutCache.enabled = false;
    const el = new Counted();
    const c = ctx();
    el.measure(loose(100), c);
    el.measure(loose(100), c);
    expect(el.computed).toBe(2);
  });

  it("hands out a copy: changing a returned size does not change the remembered one", () => {
    const el = new Counted();
    const c = ctx();
    el.measure(loose(100), c).width = 999;
    expect(el.measure(loose(100), c).width).toBe(100);
  });

  it("keeps several answers, so alternating questions do not evict each other", () => {
    const el = new Counted();
    const c = ctx();
    for (let i = 0; i < 3; i++) {
      el.measure(loose(100), c);
      el.measure(loose(Infinity), c);
    }
    expect(el.computed).toBe(2);
  });

  it("keys on each of the four constraint bounds", () => {
    const base = new BoxConstraints(0, 100, 0, 200);
    const variants = [
      new BoxConstraints(10, 100, 0, 200),
      new BoxConstraints(0, 90, 0, 200),
      new BoxConstraints(0, 100, 10, 200),
      new BoxConstraints(0, 100, 0, 190),
    ];
    for (const other of variants) {
      const el = new Counted();
      el.measure(base, ctx());
      el.measure(other, ctx());
      expect(el.computed).toBe(2);
    }
  });

  // A Text's size reads only its width, so its key drops the height bound: an overflowing Column asks
  // it once unbounded and once with a capped height, and that is ONE question for a text.
  class CountedText extends TextElement {
    computed = 0;
    protected override computeSize(c: BoxConstraints, context: LayoutContext): Size {
      this.computed++;
      return super.computeSize(c, context);
    }
  }

  it("asks a Text once, whatever height bound comes with the width", () => {
    const text = new CountedText({ content: "one two three four five six" });
    text.measure(BoxConstraints.loose(100, Infinity), ctx());
    text.measure(BoxConstraints.loose(100, 30), ctx());
    expect(text.computed).toBe(1);
  });

  it("is right to: a Text's size does not change with the height bound", () => {
    layoutCache.enabled = false;
    const text = new TextElement({ content: "one two three four five six" });
    const free = text.measure(BoxConstraints.loose(100, Infinity), ctx());
    const capped = text.measure(BoxConstraints.loose(100, 5), ctx());
    expect(capped).toEqual(free);
  });

  it("keys on the constraints", () => {
    const text = new TextElement({ content: "one two three four five six" });
    const wide = text.measure(loose(400), ctx());
    const narrow = text.measure(loose(60), ctx());
    expect(narrow.height).toBeGreaterThan(wide.height);
  });

  it("keys on the inherited text style", () => {
    const text = new TextElement({ content: "Hello" });
    const small = text.measure(loose(Infinity), ctx());
    const large = text.measure(
      loose(Infinity),
      ctx({ textStyle: mergeTextStyle(DEFAULT_TEXT_STYLE, { fontSize: 30 }) }),
    );
    expect(large.width).toBeGreaterThan(small.width);
  });

  it("keys on the font metrics", () => {
    const text = new TextElement({ content: "Hello" });
    const a = text.measure(loose(Infinity), ctx());
    const doubled: FontMetrics = testMetrics({
      getStringWidth: (t, _f, size) => [...t].length * size * 2,
    });
    const b = text.measure(loose(Infinity), ctx({ metrics: doubled }));
    expect(b.width).toBe(a.width * 2);
  });

  it("keys on the font epoch: a face added later can change a width", () => {
    let scale = 1;
    const growing = {
      ...testMetrics({
        getStringWidth: (t: string, _f: string, size: number) => [...t].length * size * scale,
      }),
      fontEpoch: 0,
    };
    const c = ctx({ metrics: growing });
    const text = new TextElement({ content: "Hello" });
    const before = text.measure(loose(Infinity), c);
    scale = 2;
    growing.fontEpoch = 1;
    expect(text.measure(loose(Infinity), c).width).toBe(before.width * 2);
  });

  it("keys on kerning: switched on the same metrics, widths change", () => {
    const kerned = {
      ...testMetrics({
        getKernPairs: (t: string) => Array.from({ length: [...t].length - 1 }, () => -100),
      }),
      kerningEnabled: false,
    };
    const c = ctx({ metrics: kerned });
    const text = new TextElement({ content: "AVAVAV" });
    const plain = text.measure(loose(Infinity), c);
    kerned.kerningEnabled = true;
    expect(text.measure(loose(Infinity), c).width).toBeLessThan(plain.width);
  });

  const page = (pageNumber: number): PageInfo => ({
    pageNumber,
    pageCount: 3,
    subPageNumber: pageNumber,
    subPageTotalPages: 3,
    pageSize: { width: 595, height: 842 },
  });
  const perPage = () =>
    new PageBuilderElement({
      build: (info) =>
        new RectangleElement({
          x: 0,
          y: 0,
          width: 10,
          height: info.pageNumber * 10,
          borderWidth: 0,
          children: [],
        }),
    });

  it("keys on the page", () => {
    const builder = perPage();
    const first = builder.measure(loose(100), ctx({ pageInfo: page(1) }));
    const second = builder.measure(loose(100), ctx({ pageInfo: page(2) }));
    expect(second.height).toBe(first.height * 2);
  });

  it("reuses a size that does not depend on the page, across pages and passes", () => {
    const el = new Counted();
    el.measure(loose(100), ctx()); // pagination: no page info yet
    el.measure(loose(100), ctx({ pageInfo: page(1), pageConfig: { pageSize: PageSize.A4 } }));
    el.measure(loose(100), ctx({ pageInfo: page(2), pageConfig: { pageSize: PageSize.A4 } }));
    expect(el.computed).toBe(1);
  });

  it("keys on the page for an element that HOLDS a PageBuilder", () => {
    const box = new RectangleElement({ x: 0, y: 0, borderWidth: 0, children: [perPage()] });
    const first = box.measure(loose(100), ctx({ pageInfo: page(1) }));
    const second = box.measure(loose(100), ctx({ pageInfo: page(2) }));
    expect(second.height).toBe(first.height * 2);
  });

  it("keys on the page config", () => {
    const builder = new PageBuilderElement({
      build: (info) =>
        new RectangleElement({
          x: 0,
          y: 0,
          width: 10,
          height: info.pageSize.width / 10,
          borderWidth: 0,
          children: [],
        }),
    });
    const a4 = builder.measure(loose(100), ctx());
    const a6 = builder.measure(loose(100), ctx({ pageConfig: { pageSize: PageSize.A6 } }));
    expect(a6.height).toBeLessThan(a4.height);
  });
});

// A subtree built at layout time (a table's rows) is kept under the context half of the same key.
describe("a subtree built from the context", () => {
  const building = (make: () => PDFElement) => {
    const built = new BuiltFromContext<PDFElement>();
    let builds = 0;
    const get = (c: LayoutContext) => built.get(c, () => (builds++, make()));
    return { get, builds: () => builds };
  };
  const page = (pageNumber: number): PageInfo => ({
    pageNumber,
    pageCount: 2,
    subPageNumber: pageNumber,
    subPageTotalPages: 2,
    pageSize: { width: 595, height: 842 },
  });

  it("is built once for the same context", () => {
    const b = building(() => new Counted());
    b.get(ctx());
    b.get(ctx());
    expect(b.builds()).toBe(1);
  });

  it("is built again when the inherited style changes", () => {
    const b = building(() => new Counted());
    b.get(ctx());
    b.get(ctx({ textStyle: mergeTextStyle(DEFAULT_TEXT_STYLE, { fontSize: 30 }) }));
    expect(b.builds()).toBe(2);
  });

  it("is reused across pages when what it built does not depend on the page", () => {
    const b = building(() => new Counted());
    b.get(ctx({ pageInfo: page(1) }));
    b.get(ctx({ pageInfo: page(2) }));
    expect(b.builds()).toBe(1);
  });

  it("is built again per page when what it built depends on the page", () => {
    const b = building(
      () =>
        new PageBuilderElement({
          build: () => new RectangleElement({ x: 0, y: 0, borderWidth: 0, children: [] }),
        }),
    );
    b.get(ctx({ pageInfo: page(1) }));
    b.get(ctx({ pageInfo: page(2) }));
    expect(b.builds()).toBe(2);
  });

  it("is built every time with the cache switched off", () => {
    layoutCache.enabled = false;
    const b = building(() => new Counted());
    b.get(ctx());
    b.get(ctx());
    expect(b.builds()).toBe(2);
  });
});

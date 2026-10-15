import { describe, it, expect, afterEach } from "vitest";
import { DeferredElement } from "../../../../src/lib/elements/layout/deferred-element.ts";
import type { PDFElement } from "../../../../src/lib/elements/pdf-element.ts";
import { Document, Page, Table, PageNumber, renderToBytes } from "../../../../src/lib/index.ts";
import { layoutCache } from "../../../../src/lib/layout/layout-cache.ts";
import { drawnPages } from "../../support/drawn.ts";

// A Deferred builds its subtree at layout time (a table measuring its `auto` columns). It keeps what
// it built and builds again only when the context changes - not on every layout call, page and pass.

/** A Deferred building a table that runs over several A6 pages; `builds` counts the builds. */
const counted = (cell: () => string | PDFElement) => {
  const state = { builds: 0 };
  const deferred = new DeferredElement(() => {
    state.builds++;
    return Table(
      { columns: [50, "1fr"], header: ["Row", "Cell"] },
      Array.from({ length: 40 }, (_, i) => [`R-${String.fromCharCode(65 + (i % 26))}`, cell()]),
    );
  });
  return { state, doc: Document([Page({ size: "A6", margin: 20 }, [deferred])]) };
};

afterEach(() => {
  layoutCache.enabled = true;
});

describe("a Deferred keeps the subtree it built", () => {
  it("builds a table running over several pages ONCE per render", async () => {
    const { state, doc } = counted(() => "text");
    const pages = await drawnPages(() => renderToBytes(doc));
    expect(pages.length).toBeGreaterThan(1);
    expect(state.builds).toBe(1);
  });

  it("builds on every call with the cache switched off", async () => {
    layoutCache.enabled = false;
    const { state, doc } = counted(() => "text");
    await renderToBytes(doc);
    expect(state.builds).toBeGreaterThan(1);
  });

  it("builds again per page when a cell depends on the page - each page shows its own number", async () => {
    const { state, doc } = counted(() => PageNumber());
    const pages = await drawnPages(() => renderToBytes(doc));
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((runs, i) => {
      // The only digits drawn are the page-number cells, and on page n every one of them reads n.
      const numbers = runs.map((r) => r.text).filter((t) => /^\d+$/.test(t));
      expect(numbers.length).toBeGreaterThan(0);
      expect(new Set(numbers)).toEqual(new Set([String(i + 1)]));
    });
    expect(state.builds).toBeGreaterThan(1);
  });
});

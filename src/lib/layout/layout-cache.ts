import type { BoxConstraints, Size } from "./box-constraints.ts";
import type { LayoutContext } from "../elements/pdf-element.ts";

/**
 * The layout cache - the one place a size is remembered. `PDFElement.measure` asks it before
 * `computeSize` runs, and stores what `computeSize` returned.
 *
 * An element never changes after it is built, so its size is a pure function of its INPUTS: the
 * constraints, plus the context fields listed in `Key` below. The same inputs again are answered from
 * the element's own cache. That is what Flutter's dry-layout cache and Yoga's measure cache do; flex
 * asks the same child the same question several times while it distributes space.
 *
 * What keeps it correct:
 * - `computeSize` reads only the context fields in `Key`. A new field that can change a size is added
 *   HERE. `frame`, `belowContent`, `pageBodyHeight` and `onOverflow` steer placement and page breaks,
 *   never a size, so they are not part of it.
 * - The page (`pageConfig`, `pageInfo`) is part of the key only for an element that
 *   `dependsOnPage()`. Every page and both passes bring new page objects, so keying everything on them
 *   would make the cache miss on each page.
 * - Context values compare by IDENTITY. Code that derives one (a merged text style) returns the same
 *   object for the same input, or every element below it misses.
 * - `fontEpoch` moves when a font face is added, and kerning can be switched on the same metrics; both
 *   change widths.
 *
 * Below this level sit value memos that are not size caches: glyph advances per font
 * (`text/advance.ts`) and a Text's displayed content (`TextElement.display`).
 */
export const layoutCache = {
  /** Off only in the test that renders every pinned document both ways and demands the same bytes. */
  enabled: true,
};

interface Key {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  metrics: LayoutContext["metrics"];
  fontEpoch: number;
  kerning: boolean | undefined;
  textStyle: LayoutContext["textStyle"];
  pageConfig: LayoutContext["pageConfig"] | undefined;
  pageInfo: LayoutContext["pageInfo"];
}

const keyOf = (c: BoxConstraints, ctx: LayoutContext, onPage: boolean): Key => ({
  minWidth: c.minWidth,
  maxWidth: c.maxWidth,
  minHeight: c.minHeight,
  maxHeight: c.maxHeight,
  metrics: ctx.metrics,
  fontEpoch: ctx.metrics?.fontEpoch ?? 0,
  kerning: ctx.metrics?.kerningEnabled,
  textStyle: ctx.textStyle,
  pageConfig: onPage ? ctx.pageConfig : undefined,
  pageInfo: onPage ? ctx.pageInfo : undefined,
});

const sameKey = (a: Key, b: Key): boolean =>
  a.minWidth === b.minWidth &&
  a.maxWidth === b.maxWidth &&
  a.minHeight === b.minHeight &&
  a.maxHeight === b.maxHeight &&
  a.metrics === b.metrics &&
  a.fontEpoch === b.fontEpoch &&
  a.kerning === b.kerning &&
  a.textStyle === b.textStyle &&
  a.pageConfig === b.pageConfig &&
  a.pageInfo === b.pageInfo;

/**
 * How many different questions one element remembers. Flex asks a child at more than one width (its
 * natural width, then its share), so one entry would evict itself.
 */
const ENTRIES = 4;

/** One element's remembered sizes, oldest overwritten first. */
export class SizeCache {
  private entries: { key: Key; size: Size }[] = [];
  private next = 0;

  get(constraints: BoxConstraints, ctx: LayoutContext, onPage: boolean): Size | undefined {
    if (!layoutCache.enabled) return undefined;
    const key = keyOf(constraints, ctx, onPage);
    const hit = this.entries.find((e) => sameKey(e.key, key));
    // A copy: a caller that adjusts the size it was handed must not change the remembered one.
    return hit && { ...hit.size };
  }

  set(constraints: BoxConstraints, ctx: LayoutContext, onPage: boolean, size: Size): void {
    const entry = { key: keyOf(constraints, ctx, onPage), size: { ...size } };
    if (this.entries.length < ENTRIES) this.entries.push(entry);
    else this.entries[this.next] = entry;
    this.next = (this.next + 1) % ENTRIES;
  }
}

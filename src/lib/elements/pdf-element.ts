import type { FontMetrics } from "../utils/font-metrics.ts";
import { SizeCache } from "../layout/layout-cache.ts";
import type { PDFPageConfig } from "./page-element.ts";
import type { ResolvedTextStyle } from "../text/text-style.ts";
import type { OverflowPolicy } from "../layout/fragmentation.ts";
import type { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";
import type { CrossAlign } from "../layout/alignment.ts";

/**
 * Everything the layout pass needs, threaded explicitly (no global singleton):
 * font metrics for measuring, and the geometry of the page currently being laid out.
 * `PageElement` sets `pageConfig` for its subtree, so each page flips against its own
 * height. The PDF byte writer is deliberately absent - layout must not touch it.
 */
/**
 * A positioning frame - the CSS "containing block" that `Positioned` children resolve their offsets
 * against: the page's content box, or a `relative` Box. Threaded to the subtree so a `Positioned`
 * can tell it has one. The frame's owner finds its `Positioned` descendants by walking the tree
 * after sizing itself, and lays them out against its own box - layout itself registers nothing.
 */
export interface PositioningFrame {
  origin: Offset;
  size: Size;
}

/**
 * What a `PageBuilder` learns about the page it landed on. `pageNumber` is 1-based and counts PHYSICAL
 * pages across the whole document (a logical `Page` that overflows contributes several); `pageCount` is
 * the document's final physical page total. `pageSize` is the media box in points, orientation applied.
 */
export interface PageInfo {
  /** 1-based, counting PHYSICAL pages across the whole document. */
  pageNumber: number;
  /** Physical pages in the whole document. */
  pageCount: number;
  /**
   * 1-based within the LOGICAL page this sheet came from - the `Page(...)` element the author wrote.
   * A document of one `Page` has `subPageNumber === pageNumber`; a document of several (an invoice
   * plus its attachment, say) restarts the count at each one.
   */
  subPageNumber: number;
  /** Physical pages this logical page produced. */
  subPageTotalPages: number;
  pageSize: { width: number; height: number };
}

export interface LayoutContext {
  metrics: FontMetrics;
  pageConfig: PDFPageConfig;
  /** The page a `PageBuilder` is being laid out on. Only the render pass knows the real numbers, so
   *  during pagination this is absent and a `PageBuilder` builds against a provisional "1 of 1". */
  pageInfo?: PageInfo;
  /** The nearest enclosing positioning frame, if any (set by a `relative` Box). */
  frame?: PositioningFrame;
  /** The cascaded text style descendants inherit (CSS/Flutter-style). Seeded at the document root
   *  from the built-in defaults + the `Document` defaults, and carried through page contexts; a
   *  `Text` resolves its own unset properties against it. Absent falls back to the built-in defaults. */
  textStyle?: ResolvedTextStyle;
  /** What to do when an element overflows a page region and cannot break (set from the render option;
   *  absent = clip silently). Evaluated in `packChildren` where the forced placement happens. */
  onOverflow?: OverflowPolicy;
  /** The FULL body height of the current page (between header and footer), set by the page driver. A
   *  `keepTogether` group reads it to decide the degrade rule: veto splitting only when the group would
   *  fit on a fresh page; a group taller than a whole page drops the veto and splits. */
  pageBodyHeight?: number;
  /** Something already sits above this element in the current page region. Then "does not fit"
   *  means "move to the next page", never an overflow - only content at the top of a fresh page is
   *  forced on and reported. Set by `packChildren`; absent = top of the page. */
  belowContent?: boolean;
}

let _nextStructId = 0;

export abstract class PDFElement {
  // Stable identity for accessible (PDF/UA) tagging: assigned once at construction and carried through
  // fragmentation copies (adoptStructId), so a paragraph or table split across pages stays ONE structure
  // element. Only the elements that actually tag (Text, Image, StructGroup) read it.
  private _structId = _nextStructId++;
  get structId(): number {
    return this._structId;
  }
  /** Make this element share `from`'s tagging identity - used by fragmentation clones. Returns this. */
  adoptStructId(from: PDFElement): this {
    this._structId = from._structId;
    return this;
  }

  /**
   * Marks this element as a piece of `original`, split across pages: it is the same element to a
   * reader of the tagged PDF (one structure element) and to the Row or Column it sits in (its flex
   * properties). Every fragmentation clone ends in this call, so a property added to the base is
   * carried in ONE place. Returns this.
   */
  asPieceOf(original: PDFElement): this {
    return this.adoptStructId(original).takeFlexItemFrom(original);
  }

  /** Takes the flex properties `original` set (CSS `align-self`, `order`, `flex-shrink`). Returns this. */
  takeFlexItemFrom(original: PDFElement): this {
    this.alignSelf = original.alignSelf ?? this.alignSelf;
    this.order = original.order ?? this.order;
    this.flexShrink = original.flexShrink ?? this.flexShrink;
    return this;
  }

  // Each subclass overrides this with its own concrete props type; `unknown` forces
  // callers holding only a base `PDFElement` to narrow before reading props.
  abstract getProps(): unknown;

  /**
   * Lays the element out: `constraints` bound its size (flows DOWN), `offset` is the
   * top-left position the parent assigns it, relative to the parent's own top-left (absolute
   * coordinates exist only in the render pass), and the returned `Size` is the
   * space it actually took (flows UP). Layout works in a top-left origin; the Y-flip
   * happens once at the IR -> backend seam.
   */
  abstract calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size;

  /**
   * The size `calculateLayout` would return under these constraints - with NO side effects: no
   * position, no stored size, nothing registered with a frame. A parent asks this to decide, and lays
   * a child out once afterwards; asking with a full layout doubled the work at every nesting level.
   * Do not override it - implement `computeSize` (as Flutter's `getDryLayout` / `computeDryLayout`).
   * The same question twice is answered from the layout cache (`layout/layout-cache.ts`).
   */
  measure(constraints: BoxConstraints, ctx: LayoutContext): Size {
    const cache = (this.sizeCache ??= new SizeCache());
    const asked = this.sizeInputs(constraints);
    const onPage = this.dependsOnPage();
    const known = cache.get(asked, ctx, onPage);
    if (known) return known;
    const size = this.computeSize(constraints, ctx);
    cache.set(asked, ctx, onPage, size);
    return size;
  }

  /**
   * The part of the constraints this element's size actually reads - what the layout cache keys on.
   * All of it by default. An element whose size ignores a bound returns it opened up, so two questions
   * that differ only there share one answer. It must be TRUE for `computeSize`: reading a bound that
   * is dropped here makes the cache hand back a wrong size.
   */
  protected sizeInputs(constraints: BoxConstraints): BoxConstraints {
    return constraints;
  }

  private sizeCache?: SizeCache;

  /**
   * Whether this element's size can depend on the page it lands on (`pageConfig`, `pageInfo`): a
   * `PageBuilder`, a `Page`, and everything holding one. Only those key a cached size on the page, so
   * every other size is reused across pages and across the pagination and render passes. Remembered:
   * the tree does not change, and an answer that was `false` can never become `true`.
   */
  dependsOnPage(): boolean {
    return (this.pageDependent ??= this.layoutChildren().some((child) => child.dependsOnPage()));
  }

  private pageDependent?: boolean;

  /**
   * How this element sizes itself for `measure`. It must come from the SAME sizing computation as
   * `calculateLayout`, or a measured size and a laid-out one can differ.
   */
  protected abstract computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size;

  /** The elements this one lays out, for walks that must see the whole tree. Leaves have none. */
  layoutChildren(): readonly PDFElement[] {
    return [];
  }

  /**
   * The element this one is transparent for, if any: a `ProxyElement` returns its child. A surrounding
   * Row or Column looks through it for the flex item (`layout/flex-item.ts`).
   */
  proxied(): PDFElement | undefined {
    return undefined;
  }

  /** Lays out its own `Positioned` descendants (a page, a `relative` Box); a walk for them stops here. */
  isPositioningFrame(): boolean {
    return false;
  }

  /**
   * The relative-size fraction (0..1) this element asked for on the given axis, if any (`horizontal` =
   * width). A flex parent reads it to resolve a percentage child against its OWN main size - e.g. a
   * `Box({ width: "50%" })` inside a Row, where the child otherwise gets an unbounded main axis and the
   * fraction would have nothing to resolve against. Default: the element is not relatively sized.
   */
  relativeSizeFactor(_horizontal: boolean): number | undefined {
    return undefined;
  }

  /**
   * Whether this element needs a BOUNDED extent on the given axis to lay itself out (`true` for a
   * horizontal axis = width). A flex parent measures its fixed children with an unbounded main axis, so
   * they keep their natural size; but a stack holding an `Expanded`/`Spacer` has no leftover space to
   * distribute unless it is told how much main axis it may occupy. Such a stack answers `true` here and
   * the parent hands it the line's bounded main extent instead of `Infinity`. Default: no.
   */
  needsBoundedMain(_horizontal: boolean): boolean {
    return false;
  }

  /**
   * The smallest main-axis extent this element can be squeezed into and still hold its content - CSS's
   * `min-content` size, which is what an automatic `min-width` resolves to on a flex item. The shrink
   * pass floors every child at this value, so a line that overflows badly stops squeezing rather than
   * grinding a paragraph down to one word per line (which would only trade a wide box for a tall one).
   *
   * `horizontal` = the width. Default 0: an element with no opinion may be squeezed to nothing, which
   * is what an empty box or a plain drawing can do without harm. Text and the layout containers
   * override it; containers recurse, since a Row is only as unsqueezable as its children.
   */
  minIntrinsicMain(_horizontal: boolean, _ctx: LayoutContext): number {
    return 0;
  }

  /**
   * Whether this element IS a forced page break (a `PageBreak`). The pagination packer cuts the flow
   * at such a marker: everything before it stays, everything after starts a new page. Default: no.
   */
  isPageBreak(): boolean {
    return false;
  }

  /**
   * Whether this element is, or CONTAINS anywhere in its subtree, a forced page break. A container
   * that merely fits by height must still be fragmented when this is true, so a break nested inside
   * it is honoured rather than swallowed. Containers override this to recurse into their children.
   * Default: no.
   */
  hasForcedBreak(): boolean {
    return false;
  }

  /**
   * Whether this element asks to START on a fresh page (CSS `break-before: page`, react-pdf's `break`
   * prop). Read by the parent packer at the child boundary, not by the element itself; ignored when the
   * element is already at the top of a region (nothing before it), so it never makes an empty page.
   * Default: no.
   */
  breaksBefore(): boolean {
    return false;
  }

  /**
   * Whether everything AFTER this element must start a fresh page (CSS `break-after: page`). Read by the
   * parent packer once this element has been placed whole. Default: no.
   */
  breaksAfter(): boolean {
    return false;
  }

  /**
   * This child's own cross-axis alignment inside its Column / Row (CSS `align-self`), overriding the
   * container's `align`. Lives on the base element because any child of a stack may set it, not just
   * the sized ones. `undefined` means "follow the container".
   */
  alignSelf?: CrossAlign;

  /** Sets `alignSelf` and returns the element, so a factory can thread it through in one expression. */
  withAlignSelf(align: CrossAlign | undefined): this {
    if (align !== undefined) this.alignSelf = align;
    return this;
  }

  /**
   * Where this child sits among its siblings (CSS `order`), lowest first, source order deciding ties.
   * It moves the child in the LAYOUT only - the element tree, and therefore the reading order a tagged
   * PDF exposes, is untouched. Unset means 0; a stack reads it through `layout/flex-item.ts`.
   */
  order?: number;

  /**
   * How willingly this child gives up main-axis space when the line overflows (CSS `flex-shrink`),
   * weighted by its own size as CSS does. Default 1, as in CSS: an overflowing line squeezes its
   * children back inside instead of letting them run past the edge of the box. `0` opts out and keeps
   * a child at its natural size.
   *
   * This was 0 until the alpha, so that adding flexShrink could not move an existing layout. That
   * caution outlived its use: four of the gallery cases turned out to be overflowing their page
   * margin without anyone noticing, because nothing ever pulled them back. Shrinking is bounded from
   * below by `minIntrinsicMain`, so a child is never squeezed past what it can actually hold.
   * Unset means 1; a stack reads it through `layout/flex-item.ts`.
   */
  flexShrink?: number;

  /** Sets `flexShrink` and returns the element. */
  withFlexShrink(shrink: number | undefined): this {
    if (shrink !== undefined) {
      if (!Number.isFinite(shrink) || shrink < 0) {
        throw new Error(`Invalid flexShrink ${shrink}: it must be a number of at least 0.`);
      }
      this.flexShrink = shrink;
    }
    return this;
  }

  /** Sets `order` and returns the element, so a factory can thread it through in one expression. */
  withOrder(order: number | undefined): this {
    if (order !== undefined) {
      if (!Number.isFinite(order)) throw new Error(`Invalid order ${order}: it must be a number.`);
      this.order = order;
    }
    return this;
  }
}

export abstract class SizedPDFElement extends PDFElement {
  protected x: number;
  protected y: number;
  protected width?: number;
  protected height?: number;

  constructor(data: SizedElement) {
    super();
    this.x = data.x;
    this.y = data.y;
    this.width = data.width;
    this.height = data.height;
  }

  public getSize(): SizedElement {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }
}

export abstract class FlexiblePDFElement extends PDFElement {
  protected flex: number;
  protected verticalChildAlignment: VerticalAlignment;
  /** Points reserved before any leftover is shared out (CSS `flex-basis`); default 0. */
  protected basis: number;
  /** The same as a fraction of the line, for `flexBasis: "25%"`. */
  protected basisFactor?: number;

  constructor(data: FlexibleElement) {
    super();
    this.flex = data.flex;
    this.verticalChildAlignment = data.verticalChildAlignment || VerticalAlignment.middle;
    this.basis = data.basis ?? 0;
    this.basisFactor = data.basisFactor;
  }

  getFlex(): number {
    return this.flex;
  }

  /**
   * The main extent this child starts from, before the leftover is shared out. `lineMain` is what the
   * line offers its items (its extent minus the gaps), so a percentage basis resolves against the same
   * base a percentage WIDTH already does - and falls back to 0 on an unbounded axis, where a fraction
   * has no meaning.
   */
  /** Whether a PERCENTAGE basis was given - it resolves to 0 on an unbounded axis, so asking for the
   *  number alone cannot tell "no basis" from "a basis that does not apply here". */
  hasBasisFactor(): boolean {
    return this.basisFactor !== undefined;
  }

  getBasis(lineMain: number): number {
    if (this.basisFactor !== undefined) {
      return Number.isFinite(lineMain) ? lineMain * this.basisFactor : 0;
    }
    return this.basis;
  }
}

export enum HorizontalAlignment {
  /** CSS `text-align: start` - the side the writing STARTS on: left in `ltr`, right in `rtl`. The
   *  default, so a right-to-left paragraph begins on the right without anyone asking for it. */
  start = "START",
  left = "LEFT",
  right = "RIGHT",
  center = "CENTER",
  /** CSS `text-align: justify` - both edges line up, the last line of a paragraph excepted. */
  justify = "JUSTIFY",
}

export enum VerticalAlignment {
  top = "TOP",
  middle = "MIDDLE",
  bottom = "BOTTOM",
}

export interface WithChildren {
  children: PDFElement[];
}

export interface WithChild {
  child: PDFElement;
}

export interface FlexibleElement {
  flex: number;
  /** Points reserved before the leftover is shared out (CSS `flex-basis`). */
  basis?: number;
  /** The same as a fraction of the line, for `flexBasis: "25%"`. */
  basisFactor?: number;
  verticalChildAlignment?: VerticalAlignment;
}

export interface SizedElement {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export function isSizedElement(obj: unknown): obj is SizedElement {
  return typeof obj === "object" && obj !== null && "x" in obj && "y" in obj;
}

export function hasChildrenProp<T extends object>(obj: T): obj is T & WithChildren {
  return "children" in obj;
}

export function hasChildProp<T extends object>(obj: T): obj is T & WithChild {
  return "child" in obj;
}

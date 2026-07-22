import type { FontMetrics } from "../utils/font-metrics.ts";
import type { PDFPageConfig } from "./page-element.ts";
import type { ResolvedTextStyle } from "../text/text-style.ts";
import type { OverflowPolicy } from "../layout/fragmentation.ts";
import type { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";

/**
 * Everything the layout pass needs, threaded explicitly (no global singleton):
 * font metrics for measuring, and the geometry of the page currently being laid out.
 * `PageElement` sets `pageConfig` for its subtree, so each page flips against its own
 * height. The PDF byte writer is deliberately absent - layout must not touch it.
 */
/**
 * A positioning frame - the CSS "containing block" that `Positioned` children resolve their
 * offsets against. A `relative` Box (later the page) creates one and threads it to its subtree;
 * `Positioned` descendants register a placement closure in `place`, which the frame drains once it
 * has finished sizing itself (so `right`/`bottom` can resolve against the final box).
 */
export interface PositioningFrame {
  origin: Offset;
  size: Size;
  place: Array<(frame: { origin: Offset; size: Size }, ctx: LayoutContext) => void>;
}

/**
 * What a `PageBuilder` learns about the page it landed on. `pageNumber` is 1-based and counts PHYSICAL
 * pages across the whole document (a logical `Page` that overflows contributes several); `pageCount` is
 * the document's final physical page total. `pageSize` is the media box in points, orientation applied.
 */
export interface PageInfo {
  pageNumber: number;
  pageCount: number;
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

  // Each subclass overrides this with its own concrete props type; `unknown` forces
  // callers holding only a base `PDFElement` to narrow before reading props.
  abstract getProps(): unknown;

  /**
   * Lays the element out: `constraints` bound its size (flows DOWN), `offset` is the
   * absolute top-left position the parent assigns it, and the returned `Size` is the
   * space it actually took (flows UP). Layout works in a top-left origin; the Y-flip
   * happens once at the IR -> backend seam.
   */
  abstract calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size;

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

  constructor(data: FlexibleElement) {
    super();
    this.flex = data.flex;
    this.verticalChildAlignment = data.verticalChildAlignment || VerticalAlignment.middle;
  }

  getFlex(): number {
    return this.flex;
  }
}

export enum HorizontalAlignment {
  left = "LEFT",
  right = "RIGHT",
  center = "CENTER",
  block = "BLOCK",
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

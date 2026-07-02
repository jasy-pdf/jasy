import { LayoutContext, PDFElement } from "../elements/pdf-element.ts";
import { BoxConstraints } from "./box-constraints.ts";

/**
 * The result of splitting an element against a fragmentation region (a page, later a
 * column). `fitted` is the part that fits in the region; `remainder` describes what did
 * not and is re-fragmented in the NEXT region. Either side may be null:
 * `fitted === null` means nothing fit, `remainder === null` means the element is done.
 *
 * Both sides are plain `PDFElement`s - the remainder is a normal element describing the
 * rest, so no information flows back UP after a break. This one-way flow is what keeps
 * fragmentation terminating (no overflow-cascade fixpoint).
 */
export interface FragmentResult {
  fitted: PDFElement | null;
  remainder: PDFElement | null;
}

/**
 * An element that knows how to split itself across regions. Width is already finalized
 * by the measure step (width-stable); `fragment` only splits height, packing into
 * `maxHeight`.
 */
export interface Fragmentable {
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult;
}

export function isFragmentable(element: PDFElement): element is PDFElement & Fragmentable {
  if (
    !("fragment" in element) ||
    typeof (element as PDFElement & { fragment: unknown }).fragment !== "function"
  ) {
    return false;
  }
  // An element may veto splitting at runtime via canFragment() - a transparent StructGroup only fragments
  // when its wrapped child does, so a non-splittable wrapped child (e.g. a table row) is moved whole to the
  // next page instead of being clipped at the boundary. Elements without canFragment() are always splittable.
  const canFragment = (element as PDFElement & { canFragment?: () => boolean }).canFragment;
  return typeof canFragment !== "function" || canFragment.call(element);
}

/**
 * What to do when an element is taller than the whole page region and cannot be broken. We always
 * still place it (clipped) so pagination terminates - this only controls how loud we are about it:
 * `"error"` throws (the default; an unbreakable overflow is almost always a layout bug), `"warn"`
 * logs and clips, `"ignore"` clips silently.
 */
export type OverflowPolicy = "error" | "warn" | "ignore";

function reportOverflow(
  child: PDFElement,
  childHeight: number,
  maxHeight: number,
  policy: OverflowPolicy,
): void {
  if (policy === "ignore") return;
  const name = child.constructor.name.replace(/Element$/, "");
  const detail =
    `${name} is ${Math.round(childHeight)}pt tall but the page region is only ` +
    `${Math.round(maxHeight)}pt and it cannot be broken - reduce its size, give it a bounded ` +
    `height, or let it split across pages.`;
  if (policy === "error") throw new Error(`Layout overflow: ${detail}`);
  console.warn(`Layout overflow (clipped): ${detail}`);
}

/**
 * Packs a vertical stack of children into `maxHeight`, in order. Children are measured
 * against `width` (unbounded height) and added until one would overflow; that straddling
 * child is itself fragmented if it can be, otherwise placed/deferred whole. Everything
 * after the break spills. Progress is guaranteed: if nothing fit, the straddling child is
 * forced on (it overflows) so the next region always advances.
 *
 * `gap` is the spacing the parent inserts BETWEEN children (a `Column` gap) - it must be
 * counted here, otherwise the packed fragment renders taller than `maxHeight` (the gaps
 * are added back at render time) and overflows the region.
 *
 * Shared by every element that lays out a vertical stack and can split it across regions
 * (Container, and the decorated boxes Padding/Rectangle).
 */
export function packChildren(
  children: PDFElement[],
  maxHeight: number,
  width: number,
  ctx: LayoutContext,
  gap: number = 0,
): { fitted: PDFElement[]; remainder: PDFElement[] } {
  const fitted: PDFElement[] = [];
  const remainder: PDFElement[] = [];
  let usedHeight = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childHeight = child.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      { x: 0, y: 0 },
      ctx,
    ).height;

    // A gap precedes every child except the first one placed in this region.
    const lead = fitted.length > 0 ? gap : 0;

    if (usedHeight + lead + childHeight <= maxHeight) {
      fitted.push(child);
      usedHeight += lead + childHeight;
      continue;
    }

    // `child` straddles the boundary. Try to split it; otherwise place/defer it whole.
    const remaining = maxHeight - usedHeight - lead;
    let placedPart = false;
    if (isFragmentable(child)) {
      const split = child.fragment(Math.max(0, remaining), width, ctx);
      if (split.fitted) {
        fitted.push(split.fitted);
        if (split.remainder) remainder.push(split.remainder);
        placedPart = true;
      }
    }
    if (!placedPart) {
      if (fitted.length === 0) {
        // Taller than the whole region and unsplittable: force it on (it overflows and is clipped)
        // so the next region still advances - and surface it per the overflow policy.
        reportOverflow(child, childHeight, maxHeight, ctx.onOverflow ?? "ignore");
        fitted.push(child);
      } else {
        remainder.push(child);
      }
    }

    for (let j = i + 1; j < children.length; j++) remainder.push(children[j]);
    break;
  }

  return { fitted, remainder };
}

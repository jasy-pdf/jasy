import { LayoutContext, PDFElement } from "../elements/pdf-element";
import { BoxConstraints } from "./box-constraints";

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

export function isFragmentable(
  element: PDFElement
): element is PDFElement & Fragmentable {
  return (
    "fragment" in element &&
    typeof (element as PDFElement & { fragment: unknown }).fragment ===
      "function"
  );
}

/**
 * Packs a vertical stack of children into `maxHeight`, in order. Children are measured
 * against `width` (unbounded height) and added until one would overflow; that straddling
 * child is itself fragmented if it can be, otherwise placed/deferred whole. Everything
 * after the break spills. Progress is guaranteed: if nothing fit, the straddling child is
 * forced on (it overflows) so the next region always advances.
 *
 * Shared by every element that lays out a vertical stack and can split it across regions
 * (Container, and the decorated boxes Padding/Rectangle).
 */
export function packChildren(
  children: PDFElement[],
  maxHeight: number,
  width: number,
  ctx: LayoutContext
): { fitted: PDFElement[]; remainder: PDFElement[] } {
  const fitted: PDFElement[] = [];
  const remainder: PDFElement[] = [];
  let usedHeight = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childHeight = child.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      { x: 0, y: 0 },
      ctx
    ).height;

    if (usedHeight + childHeight <= maxHeight) {
      fitted.push(child);
      usedHeight += childHeight;
      continue;
    }

    // `child` straddles the boundary. Try to split it; otherwise place/defer it whole.
    const remaining = maxHeight - usedHeight;
    let placedPart = false;
    if (isFragmentable(child)) {
      const split = child.fragment(remaining, width, ctx);
      if (split.fitted) {
        fitted.push(split.fitted);
        if (split.remainder) remainder.push(split.remainder);
        placedPart = true;
      }
    }
    if (!placedPart) {
      if (fitted.length === 0) fitted.push(child);
      else remainder.push(child);
    }

    for (let j = i + 1; j < children.length; j++) remainder.push(children[j]);
    break;
  }

  return { fitted, remainder };
}

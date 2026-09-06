/**
 * `min-content` sizing - the smallest extent a subtree can be squeezed into and still hold together.
 *
 * The shrink pass in `FlexLayoutHelper` floors every child at this, so an overflowing line stops
 * squeezing instead of grinding a paragraph down to one word per line. It is the same rule a browser
 * applies through the automatic `min-width` of a flex item (CSS Flexbox 4.5).
 *
 * Only the leaves know a real number - a `Text` its longest word, everything else nothing in
 * particular. These helpers are how a container folds its children's answers into its own.
 */
import type { LayoutContext } from "../elements/pdf-element.ts";
import type { PDFElement } from "../elements/pdf-element.ts";

/**
 * The children's floor, folded along one axis: children laid out ALONG the queried axis have to fit
 * side by side, so their floors add up (plus the gaps between them); across it they merely overlap,
 * so the widest one wins.
 *
 * A wrapping stack adds up nothing: it may put every child on its own line, so it is only as wide as
 * its widest child - which is what CSS says about a multi-line flex container too.
 */
export function stackMinIntrinsic(
  children: PDFElement[],
  gap: number,
  alongAxis: boolean,
  horizontal: boolean,
  ctx: LayoutContext,
  wraps = false,
): number {
  const floors = children.map((c) => c.minIntrinsicMain(horizontal, ctx));
  if (floors.length === 0) return 0;
  if (!alongAxis || wraps) return Math.max(...floors);
  return floors.reduce((sum, f) => sum + f, 0) + gap * (floors.length - 1);
}

/**
 * Folds an element's own declared extent into the floor its content asks for. CSS calls these the
 * "specified size suggestion" and the "content size suggestion" and takes the SMALLER: a box that
 * declares 400pt around content needing 50 may still be squeezed to 50, while one declaring 400
 * around content needing 500 cannot go below 400. An extent given as a fraction is not a suggestion
 * at all - it has no size of its own until the parent is known - so it is ignored here.
 */
export function withDeclaredExtent(
  contentFloor: number,
  declared: number | undefined,
  explicitMin?: number,
): number {
  // An explicit `minWidth`/`minHeight` REPLACES the automatic minimum - it does not compete with it.
  // CSS applies the automatic minimum only while `min-width` is `auto`, so a smaller explicit value
  // wins too: `min-width: 0` is the standard way to let a flex item shrink past its longest word, and
  // taking the larger of the two would quietly ignore it. Measured in Chrome on one long word in a
  // 200pt line: 132.08pt with `auto`, 84.64pt with `0`.
  if (explicitMin !== undefined) return explicitMin;
  // Without an explicit bound the floor is CSS's content-based minimum: the smaller of what the
  // element declares and what its content actually needs. It matters because the shrink pass must not
  // aim below a size the child will refuse - the share it was supposed to give would never arrive,
  // and the line would stay over its width.
  return declared === undefined ? contentFloor : Math.min(declared, contentFloor);
}

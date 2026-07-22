import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { Fragmentable, FragmentResult, isFragmentable } from "../../layout/fragmentation.ts";
import { LayoutContext, PDFElement } from "../pdf-element.ts";

/**
 * A layout-TRANSPARENT wrapper that tries to keep its content on ONE page (CSS `break-inside: avoid`).
 * It delegates all layout and rendering to its child, so the visual result is byte-identical to the
 * unwrapped content; only pagination behaves differently.
 *
 * The rule, decided in `fragment`:
 *   1. Fits in the space offered here           -> place it whole.
 *   2. Does not fit here but fits on a FRESH    -> veto the split: defer the whole group to the next
 *      full page                                   page (`fitted: null`), so it lands together there.
 *   3. Taller than a whole page                 -> drop the veto and split normally. A group that can
 *                                                  never fit on one page must break, or pagination
 *                                                  could not terminate. Inner `keepTogether`s survive
 *                                                  this (they are separate elements, re-evaluated when
 *                                                  the child splits) - graceful degrade, outer->inner.
 *
 * A forced page break inside the group (a `PageBreak`, or a `breakBefore`/`breakAfter`) contradicts
 * keeping it together: the break wins (CSS behaves the same), and we WARN once rather than silently
 * swallowing either intent.
 */
export class KeepTogetherElement extends PDFElement implements Fragmentable {
  private child: PDFElement;
  private warnedBreakConflict = false;

  constructor({ child }: { child: PDFElement }) {
    super();
    this.child = child;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    return this.child.calculateLayout(constraints, offset, ctx);
  }

  // Transparent: forward the sizing hints the flex parent reads, so a %-sized or Spacer-holding child
  // keeps working when it is wrapped (the wrapper must not swallow these).
  override relativeSizeFactor(horizontal: boolean): number | undefined {
    return this.child.relativeSizeFactor(horizontal);
  }

  override needsBoundedMain(horizontal: boolean): boolean {
    return this.child.needsBoundedMain(horizontal);
  }

  // Transparent to break control: a break-before/after on the wrapped element still applies to the group
  // as a whole, and an inner forced break still forces the parent to fragment us (so `fragment` runs).
  override hasForcedBreak(): boolean {
    return this.child.hasForcedBreak();
  }

  override breaksBefore(): boolean {
    return this.child.breaksBefore();
  }

  override breaksAfter(): boolean {
    return this.child.breaksAfter();
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    // Contradiction: a forced break inside the group beats keeping it together. Split at the break by
    // delegating to the child (which honours it), and say so once - never keep such a group whole.
    if (this.child.hasForcedBreak()) {
      if (!this.warnedBreakConflict) {
        this.warnedBreakConflict = true;
        console.warn(
          "keepTogether contains a forced page break (PageBreak / breakBefore / breakAfter). The break " +
            "wins and the group is split. Remove the break, or the keepTogether, to resolve this.",
        );
      }
      return this.splitChild(maxHeight, width, ctx);
    }

    const natural = this.child.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      { x: 0, y: 0 },
      ctx,
    ).height;

    // 1. Fits in the offered space: keep whole.
    if (natural <= maxHeight) return { fitted: this, remainder: null };

    // 2. Would fit on a fresh full page: veto the split, defer the whole group to the next page. Only
    //    reachable in a PARTIAL region (something is already on this page); alone on a full page,
    //    `maxHeight` IS the page body, so `natural > maxHeight` means case 3, never this.
    const pageBody = ctx.pageBodyHeight ?? maxHeight;
    if (natural <= pageBody) return { fitted: null, remainder: this };

    // 3. Bigger than a whole page: it can never be kept together, so split it.
    return this.splitChild(maxHeight, width, ctx);
  }

  /** Delegate the actual split to the child, unwrapping - once we have decided to break the group, the
   *  pieces just flow (any INNER keepTogether lives in the child subtree and still vetoes there). */
  private splitChild(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    if (!isFragmentable(this.child)) return { fitted: null, remainder: this };
    return this.child.fragment(maxHeight, width, ctx);
  }

  override getProps() {
    return { child: this.child };
  }
}

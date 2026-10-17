import { BoxConstraints } from "../../layout/box-constraints.ts";
import { FragmentResult } from "../../layout/fragmentation.ts";
import { LayoutContext, PDFElement } from "../pdf-element.ts";
import { ProxyElement } from "./proxy-element.ts";
import { diagnose, pageOf } from "../../common/diagnostics.ts";

/**
 * A layout-transparent wrapper (a `ProxyElement`) that tries to keep its content on ONE page (CSS
 * `break-inside: avoid`). Only pagination behaves differently from the unwrapped content.
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
export class KeepTogetherElement extends ProxyElement {
  constructor({ child }: { child: PDFElement }) {
    super(child);
  }

  // Once the group is broken, its pieces flow bare (see `splitChild`).
  protected override rewrap(child: PDFElement): PDFElement {
    return child;
  }

  override fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    // Contradiction: a forced break inside the group beats keeping it together. Split at the break by
    // delegating to the child (which honours it), and say so once - never keep such a group whole.
    if (this.child.hasForcedBreak()) {
      diagnose(ctx.diagnostics, {
        code: "keep-together-split",
        severity: "warning",
        message:
          "keepTogether contains a forced page break (PageBreak / breakBefore / breakAfter). The break " +
          "wins and the group is split. Remove the break, or the keepTogether, to resolve this.",
        about: this,
        page: pageOf(ctx),
      });
      return this.splitChild(maxHeight, width, ctx);
    }

    const natural = this.child.measure(BoxConstraints.loose(width, Infinity), ctx).height;

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

  /** Split like any wrapper - once we have decided to break the group, the pieces flow bare but keep
   *  the group's place in the flex line (any INNER keepTogether lives in the child and still vetoes). */
  private splitChild(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    return super.fragment(maxHeight, width, ctx);
  }

  override getProps() {
    return { child: this.child };
  }
}

/**
 * Orphan and widow control for a paragraph split across a page break.
 *
 * An **orphan** is the first line of a paragraph left alone at the bottom of a page; a **widow** is
 * the last line pushed alone to the top of the next. Both read as mistakes, and neither is prevented
 * by splitting at line boxes - which is all the fragmenter does on its own.
 *
 * This is a correction of the split INDEX, not a second mechanism: the fragmenter works out how many
 * lines fit, and this decides whether that number is acceptable.
 */

/** How many lines must stay behind / must carry over. CSS and every browser default both to 2. */
export interface OrphanWidowRule {
  orphans: number;
  widows: number;
}

export const DEFAULT_ORPHANS = 2;
export const DEFAULT_WIDOWS = 2;

/**
 * Correct a line count so the split leaves at least `orphans` lines behind and carries at least
 * `widows` over. Returns 0 to mean "none of it fits here" - the caller then moves the whole paragraph
 * on, exactly as it already does when not even one line fits.
 *
 * Terminating by construction: every answer is either the natural count, a SMALLER one, or 0. It
 * never asks for more lines than fit, and the page driver's guard already handles a paragraph that
 * does not fit on a whole page (it places it anyway rather than looping).
 */
export function adjustForOrphansWidows(
  fitted: number,
  total: number,
  { orphans, widows }: OrphanWidowRule,
): number {
  if (fitted <= 0) return 0; // nothing fits; the caller decides
  if (fitted >= total) return total; // no split needed, nothing to protect

  // NOTE: an explicit "too short to satisfy both ends" rule (total < orphans + widows) sat here and was
  // removed - it is unreachable. Either fewer lines stay than `orphans` allows, and the next check
  // returns 0; or at least `orphans` stay, and then fewer than `widows` must carry, so the pull-back
  // below lands under `orphans` and returns 0 as well. react-pdf spells the case out; we do not need to.
  //
  // Fewer lines would stay than an orphan is allowed to be.
  if (fitted < orphans) return 0;

  // Fewer lines would carry over than a widow is allowed to be: pull the cut back so exactly `widows`
  // go over - unless that would leave too few behind, in which case the paragraph moves whole.
  if (total - fitted < widows) {
    const pulled = total - widows;
    return pulled >= orphans ? pulled : 0;
  }

  return fitted;
}

/**
 * Resolved and unresolved edge insets, on the LAYOUT side of the seam.
 *
 * The public `Insets` input (points, percentages, four shapes) lives in `api/insets.ts` and normalizes
 * into the specs below - the same split `dimension.ts` and `box-constraints.ts` already use for sizes,
 * so an element never sees a percentage string and the api layer never sees layout geometry.
 */

/** One side: an absolute point size, or a fraction of the available width. */
export interface EdgeSpec {
  points?: number;
  factor?: number;
}

/**
 * `[top, right, bottom, left]`, each still unresolved.
 *
 * A plain number is accepted as shorthand for `{ points: n }`: the engine elements are exported for
 * power users and used to take four numbers, so requiring `{ points: 5 }` would break them for a
 * feature they are not using.
 */
export type EdgeSpecs = [EdgeInput, EdgeInput, EdgeInput, EdgeInput];

/** A side as given: points for short, or a spec when it may be a percentage. */
export type EdgeInput = number | EdgeSpec;

/**
 * Turn the specs into points. `available` is the WIDTH the element was offered - a percentage resolves
 * against the width on ALL FOUR sides, top and bottom included, which is the CSS rule (and Yoga's, so
 * react-pdf agrees). An unbounded width leaves a percentage at 0, the no-op a percentage size gives.
 */
export function resolveEdges(
  specs: EdgeSpecs,
  available: number,
): [number, number, number, number] {
  const one = (e: EdgeInput) => {
    if (typeof e === "number") return e;
    return (
      e.points ?? (e.factor !== undefined && Number.isFinite(available) ? available * e.factor : 0)
    );
  };
  return [one(specs[0]), one(specs[1]), one(specs[2]), one(specs[3])];
}

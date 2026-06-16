/**
 * Spacing input for padding / margin (locked design §3). Units are PDF points. Every form
 * normalizes to the engine's `[top, right, bottom, left]` via `toEdges`, so you can reach
 * for whichever shape fits and never think about the engine order.
 */
export type Insets =
  | number // all four sides
  | { x?: number; y?: number } // horizontal (left+right) / vertical (top+bottom)
  | { top?: number; right?: number; bottom?: number; left?: number } // per side
  | [number, number, number, number]; // [top, right, bottom, left] (engine order)

/** Normalizes any `Insets` to the engine's `[top, right, bottom, left]`. */
export function toEdges(i: Insets): [number, number, number, number] {
  if (typeof i === "number") return [i, i, i, i];
  if (Array.isArray(i)) return i;

  // Axis form ({x, y}) and per-side form ({top,...}) are both all-optional objects (TS
  // can't discriminate them), so read through one shape: an axis key present picks the
  // axis interpretation (an empty object is all-zero either way).
  const o = i as {
    x?: number;
    y?: number;
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  if (o.x !== undefined || o.y !== undefined) {
    const x = o.x ?? 0;
    const y = o.y ?? 0;
    return [y, x, y, x];
  }

  return [o.top ?? 0, o.right ?? 0, o.bottom ?? 0, o.left ?? 0];
}

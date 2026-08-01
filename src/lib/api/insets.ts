import { SizeInput, toDimension } from "./dimension.ts";
import type { EdgeInput, EdgeSpecs } from "../layout/insets.ts";

/**
 * Spacing input for padding / margin (locked design §3). Points, or a percentage string like `"5%"`.
 * Every form normalizes to the engine's `[top, right, bottom, left]` via `toEdges`, so you can reach
 * for whichever shape fits and never think about the engine order.
 *
 * **A percentage resolves against the available WIDTH - on all four sides, top and bottom included.**
 * That is the CSS rule, and Yoga's, so react-pdf behaves the same. It reads as wrong the first time and
 * is what makes `padding-bottom: 56.25%` a 16:9 box on the web. A percentage needs a bounded width; in
 * an unbounded region it resolves to 0, the same no-op a percentage SIZE gives there.
 */
export type Insets =
  | SizeInput // all four sides
  | { x?: SizeInput; y?: SizeInput } // horizontal (left+right) / vertical (top+bottom)
  | { top?: SizeInput; right?: SizeInput; bottom?: SizeInput; left?: SizeInput } // per side
  | [SizeInput, SizeInput, SizeInput, SizeInput]; // [top, right, bottom, left] (engine order)

// A fixed side stays a plain NUMBER, so the output is unchanged for every input that was legal before
// this file learned percentages - `toEdges` is publicly exported and did not need to break.
const spec = (v: SizeInput | undefined): EdgeInput => {
  if (v === undefined) return 0;
  const d = toDimension(v);
  return d.points ?? { factor: d.factor };
};

/** Normalizes any `Insets` to the engine's `[top, right, bottom, left]`, percentages still unresolved. */
export function toEdges(i: Insets): EdgeSpecs {
  if (typeof i === "number" || typeof i === "string") {
    const s = spec(i);
    return [s, s, s, s];
  }
  if (Array.isArray(i)) return [spec(i[0]), spec(i[1]), spec(i[2]), spec(i[3])];

  // Axis form ({x, y}) and per-side form ({top,...}) are both all-optional objects (TS
  // can't discriminate them), so read through one shape: an axis key present picks the
  // axis interpretation (an empty object is all-zero either way).
  const o = i as {
    x?: SizeInput;
    y?: SizeInput;
    top?: SizeInput;
    right?: SizeInput;
    bottom?: SizeInput;
    left?: SizeInput;
  };
  if (o.x !== undefined || o.y !== undefined) {
    const x = spec(o.x);
    const y = spec(o.y);
    return [y, x, y, x];
  }

  return [spec(o.top), spec(o.right), spec(o.bottom), spec(o.left)];
}

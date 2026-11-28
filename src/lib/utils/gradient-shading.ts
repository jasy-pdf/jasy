import type { Color } from "../common/color.ts";
import type { Gradient, GradientStop } from "../ir/display-list.ts";

/**
 * Where each stop sits on the shading's 0..1 domain, at the precision `/Bounds` is written with: the
 * first at 0, the last at 1, the ones between at their offsets. An inner stop ON an end is moved in by
 * one step: the shading extends its end values, which must be the outermost stop's, so a hard edge
 * there needs a piece of its own.
 */
export function stopPositions(stops: GradientStop[]): number[] {
  const step = 1e-4;
  const last = stops.length - 1;
  return stops.map((s, i) =>
    i === 0
      ? 0
      : i === last
        ? 1
        : Math.min(1 - step, Math.max(step, Math.round(s.offset / step) * step)),
  );
}

/** Each stop's opacity, times the gradient's own. */
export function stopAlphas(g: Gradient): number[] {
  const a = g.alpha ?? 1;
  return g.stops.map((s) => s.color.getAlpha() * a);
}

/**
 * The color at `n` even steps from one stop to the next, interpolated PREMULTIPLIED as CSS does: a
 * stop counts by its alpha, so a fade to `transparent` keeps the other stop's color instead of
 * passing through black. 8-bit RGB triples, for one sampled piece; the alpha goes into the soft mask.
 */
export function premultipliedSamples(from: Color, to: Color, n = 256): Uint8Array {
  const out = new Uint8Array(n * 3);
  const c0 = from.toArray();
  const c1 = to.toArray();
  for (let k = 0; k < n; k++) {
    const u = k / (n - 1);
    let w0 = from.getAlpha() * (1 - u);
    let w1 = to.getAlpha() * u;
    // On a transparent stop itself both weights vanish: take the color it fades into (the limit), and
    // between two transparent stops, which the mask hides anyway, the plain mix.
    if (w0 + w1 === 0)
      [w0, w1] =
        from.getAlpha() + to.getAlpha() > 0 ? [from.getAlpha(), to.getAlpha()] : [1 - u, u];
    for (let ch = 0; ch < 3; ch++) {
      out[k * 3 + ch] = Math.round((c0[ch]! * w0 + c1[ch]! * w1) / (w0 + w1));
    }
  }
  return out;
}

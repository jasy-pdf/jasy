import { alignSelfOf, flexibleOf, flexShrinkOf, orderOf } from "../layout/flex-item.ts";
import { PDFElement, LayoutContext, type FlexiblePDFElement } from "../elements/pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";

/** `layout` places every child (one `calculateLayout` each); `measure` only sizes, with no side effects. */
export type FlexMode = "layout" | "measure";

const sameConstraints = (a: BoxConstraints, b: BoxConstraints) =>
  a.minWidth === b.minWidth &&
  a.maxWidth === b.maxWidth &&
  a.minHeight === b.minHeight &&
  a.maxHeight === b.maxHeight;

// Re-exported so every existing import keeps working; the definitions live in layout/alignment.ts.
export type { MainAlign, CrossAlign } from "../layout/alignment.ts";
import type { CrossAlign, MainAlign } from "../layout/alignment.ts";

/**
 * Maps the abstract MAIN/CROSS axes onto concrete width/height + x/y, so one flex
 * algorithm drives both a vertical Column (main = height) and a horizontal Row
 * (main = width). "main" is the stacking direction; "cross" is perpendicular.
 */
export interface FlexAxis {
  /** Whether the MAIN (stacking) axis is horizontal - i.e. this is a Row. Used to ask a child for the
   *  right relative-size factor (width vs height) when resolving a percentage child. */
  mainHorizontal: boolean;
  mainOf(size: Size): number;
  crossOf(size: Size): number;
  /**
   * Constraints for a fixed child: the main extent is unbounded by default (the child takes its
   * natural size); the cross extent is ALWAYS capped to what the line offers. The cap is a hard
   * ceiling regardless of `cross` alignment - it is what guarantees nothing ever overflows
   * (a paragraph wraps at the column width instead of running one line off the page). A
   * child smaller than the cap keeps its size and is positioned by `crossOffset`; a child
   * that wants to fill (Container, Text) fills the cap. So `stretch` vs `start/center/end`
   * differ only in where a smaller child sits, never in the ceiling.
   *
   * `mainMax` bounds the main axis too (default unbounded): passed only for a PERCENTAGE child, so its
   * `width: "50%"` can resolve against the space the line offers its items. A plain child keeps the
   * unbounded main axis and shrink-wraps as before.
   */
  measureConstraints(crossAvail: number, mainMax?: number): BoxConstraints;
  /** Constraints for a flex child (fills the cross axis like a stretched child). */
  flexConstraints(mainExtent: number, crossAvail: number): BoxConstraints;
  /** Offset (from the stack's top-left) of a child at main position `mainPos`, cross `crossPos`. */
  offsetAt(mainPos: number, crossPos: number): Offset;
}

export const VERTICAL_AXIS: FlexAxis = {
  mainHorizontal: false,
  mainOf: (s) => s.height,
  crossOf: (s) => s.width,
  measureConstraints: (crossAvail, mainMax = Infinity) => BoxConstraints.loose(crossAvail, mainMax),
  flexConstraints: (mainExtent, crossAvail) => BoxConstraints.loose(crossAvail, mainExtent),
  offsetAt: (mainPos, crossPos) => ({ x: crossPos, y: mainPos }),
};

export const HORIZONTAL_AXIS: FlexAxis = {
  mainHorizontal: true,
  mainOf: (s) => s.width,
  crossOf: (s) => s.height,
  measureConstraints: (crossAvail, mainMax = Infinity) => BoxConstraints.loose(mainMax, crossAvail),
  flexConstraints: (mainExtent, crossAvail) => BoxConstraints.loose(mainExtent, crossAvail),
  offsetAt: (mainPos, crossPos) => ({ x: mainPos, y: crossPos }),
};

/** Cross-axis offset of a child of size `childCross` within `crossExtent`. */
function crossOffset(align: CrossAlign, crossExtent: number, childCross: number): number {
  if (align === "center") return Math.max(0, (crossExtent - childCross) / 2);
  if (align === "end") return Math.max(0, crossExtent - childCross);
  return 0; // start, stretch (stretch fills, so no offset)
}

export interface FlexOptions {
  gap?: number;
  main?: MainAlign;
  cross?: CrossAlign;
  /** Lay the children out along the main axis backwards (CSS `row-reverse` / `column-reverse`). */
  reverse?: boolean;
  /** Let the children flow onto further lines when they do not fit (CSS `flex-wrap: wrap`). */
  wrap?: boolean;
  /** How the BLOCK of wrapped lines sits across the axis (CSS `align-content`). Default `start`. */
  alignContent?: MainAlign;
}

/**
 * The order children are LAID OUT in: by `order` (lowest first, ties keeping source order), then
 * reversed if the container asks for it. The element tree itself is never touched, so the reading order
 * a tagged PDF exposes stays the source order - which is what CSS says too.
 *
 * `sort` is stable in every engine we target, so equal `order` values keep their source positions and a
 * container where nobody sets one comes back with the identical array.
 */
function inLayoutOrder(children: PDFElement[], reverse: boolean): PDFElement[] {
  const ordered = children.some((c) => orderOf(c) !== 0)
    ? [...children].sort((a, b) => orderOf(a) - orderOf(b))
    : children;
  return reverse ? [...ordered].reverse() : ordered;
}

/**
 * The main-axis alignment as the container means it. Reversed, the axis runs from the other end: `start`
 * is where the first child of the REVERSED order sits - the right of a Row, the bottom of a Column (CSS
 * `row-reverse` with `flex-start`, Flutter's `MainAxisAlignment.start` on a reversed axis). `center`,
 * `between` and `around` are symmetric and stay.
 */
function mainAlignOf(options: FlexOptions): MainAlign {
  const main = options.main ?? "start";
  if (!options.reverse) return main;
  return main === "start" ? "end" : main === "end" ? "start" : main;
}

export class FlexLayoutHelper {
  /**
   * Lays out the children along `axis`, on one line or several.
   *
   * Without `wrap` this is the single-line engine and nothing about it changed - the call goes
   * straight through, which is what keeps every existing document byte-identical. With `wrap` the
   * children are split into lines first and the SAME engine runs once per line.
   */
  static layout(
    children: PDFElement[],
    axis: FlexAxis,
    mainAvail: number,
    crossAvail: number,
    options: FlexOptions,
    ctx: LayoutContext,
    mode: FlexMode = "layout",
  ): { mainUsed: number; crossUsed: number } {
    if (!options.wrap || children.length === 0 || !Number.isFinite(mainAvail)) {
      // An unbounded main axis has no edge to wrap at, so wrapping there is meaningless, not an error.
      return FlexLayoutHelper.layoutLine(
        children,
        axis,
        mainAvail,
        crossAvail,
        0,
        options,
        ctx,
        mode,
      );
    }
    return FlexLayoutHelper.layoutWrapped(
      children,
      axis,
      mainAvail,
      crossAvail,
      options,
      ctx,
      mode,
    );
  }

  /**
   * The wrapping path: split into lines, lay each one out, then place the lines across the axis.
   *
   * Lines are laid out TWICE - once to learn how tall each is, once at its final cross position. That
   * is the same measure-then-place shape the single-line engine already uses, and it is what
   * `alignContent` needs: the block of lines can only be centred once its total is known.
   */
  private static layoutWrapped(
    children: PDFElement[],
    axis: FlexAxis,
    mainAvail: number,
    crossAvail: number,
    options: FlexOptions,
    ctx: LayoutContext,
    mode: FlexMode,
  ): { mainUsed: number; crossUsed: number } {
    const gap = options.gap ?? 0;
    const ordered = inLayoutOrder(children, options.reverse ?? false);

    // Which children share a line. A child counts with its natural main extent; a flex child with its
    // BASIS, which is 0 unless it asked for one - so it never forces a break by itself. A PERCENTAGE
    // child's size depends on how many gaps the line ends up with, so it is asked again for every
    // candidate membership. A plain child's extent does not, so it is measured ONCE and remembered -
    // otherwise each membership probe re-lays every child already on the line (O(n^2) subtree layouts).
    const measured = new Map<PDFElement, number>();
    const naturalMain = (child: PDFElement, base: number): number => {
      const flexible = flexibleOf(child);
      if (flexible) return flexible.getBasis(base);
      const factor = child.relativeSizeFactor(axis.mainHorizontal);
      if (factor !== undefined) return base * factor;
      const cached = measured.get(child);
      if (cached !== undefined) return cached;
      // Measured UNCAPPED, the same way the single-line engine measures a plain child. Handing the
      // line width in as a cap would silently squash a child wider than the line - CSS lets such a
      // child overflow, and so does our own non-wrapping path. A stack holding a Spacer counts with its
      // content too: its Spacer only grows into what is left once the line is laid out.
      const main = axis.mainOf(child.measure(axis.measureConstraints(crossAvail, Infinity), ctx));
      measured.set(child, main);
      return main;
    };

    /** What a line of these children would occupy, resolving every `%` against ITS gap count. */
    const lineExtent = (members: PDFElement[]): number => {
      const gaps = Math.max(0, members.length - 1) * gap;
      const base = Math.max(0, mainAvail - gaps);
      return members.reduce((n, c) => n + naturalMain(c, base), 0) + gaps;
    };

    const lines: PDFElement[][] = [[]];
    for (const child of ordered) {
      const current = lines[lines.length - 1];
      // A child wider than a whole line still gets one of its own rather than an empty line before it.
      if (current.length > 0 && lineExtent([...current, child]) > mainAvail) {
        lines.push([child]);
      } else {
        current.push(child);
      }
    }

    // Each line keeps SOURCE order internally: the ordering was applied above, and applying it again
    // per line would reverse twice.
    const lineOptions = { ...options, wrap: false, reverse: false, main: mainAlignOf(options) };
    const measure = lines.map((line) =>
      FlexLayoutHelper.layoutLine(
        line,
        axis,
        mainAvail,
        // Across a Column a child gets the column's width, as a block does in CSS (a paragraph wraps
        // inside it); across a Row it is as tall as its content. Either way the line is only as big as
        // what is on it, so `stretch` fills the line and not the container.
        axis.mainHorizontal ? Infinity : crossAvail,
        0,
        lineOptions,
        ctx,
        "measure",
        true,
      ),
    );

    const heights = measure.map((m) => m.crossUsed);
    const totalCross = heights.reduce((n, h) => n + h, 0) + Math.max(0, lines.length - 1) * gap;

    // `alignContent` distributes the BLOCK of lines across the axis, using the same vocabulary the main
    // axis uses. Only meaningful in a bounded cross axis with room left over.
    const slack = Number.isFinite(crossAvail) ? crossAvail - totalCross : 0;
    const align = options.alignContent ?? "start";
    let cursor = 0;
    let between = gap;
    if (slack > 0) {
      if (align === "center") cursor += slack / 2;
      else if (align === "end") cursor += slack;
      else if (align === "between" && lines.length > 1) between = gap + slack / (lines.length - 1);
      else if (align === "around") {
        const unit = slack / lines.length;
        cursor += unit / 2;
        between = gap + unit;
      }
    }

    lines.forEach((line, i) => {
      FlexLayoutHelper.layoutLine(
        line,
        axis,
        mainAvail,
        heights[i], // the line's own extent, so `stretch` fills the line and not the container
        cursor,
        lineOptions,
        ctx,
        mode,
      );
      cursor += heights[i];
      if (i < lines.length - 1) cursor += between;
    });

    return { mainUsed: mainAvail, crossUsed: Math.max(totalCross, cursor) };
  }

  /**
   * Lays out ONE flex line along `axis` and places every child. Fixed children take their natural main
   * extent; flex children split the leftover by their `flex`; `gap` goes between children. `main`
   * distributes leftover when nothing flexes; `cross` positions or stretches each child across the line.
   * Returns the main extent consumed and the cross extent occupied.
   *
   * The steps run in this order, and the order is part of the result: `leftover` is taken after the
   * shrink and before the share, and the main-axis spacing reads exactly that value.
   */
  private static layoutLine(
    children: PDFElement[],
    axis: FlexAxis,
    mainAvail: number,
    crossAvail: number,
    crossOrigin: number,
    options: FlexOptions,
    ctx: LayoutContext,
    mode: FlexMode,
    // The line's cross extent is its content, not `crossAvail`: one line of a wrapping container.
    crossFromContent = false,
  ): { mainUsed: number; crossUsed: number } {
    const gap = options.gap ?? 0;
    const ordered = inLayoutOrder(children, options.reverse ?? false);
    const totalGap = Math.max(0, ordered.length - 1) * gap;
    const line: FlexLine = {
      children: ordered,
      axis,
      mainAvail,
      crossAvail,
      ctx,
      totalGap,
      // The main extent a percentage child resolves against: the line minus the gaps between its items,
      // so N children at (100/N)% + gaps fit exactly (the flexbox `width: 33%` + gap trap). Only finite
      // on a bounded main axis - a fraction of an unbounded one has no meaning, so `%` shrink-wraps.
      percentBase: mainAvail !== Infinity ? Math.max(0, mainAvail - totalGap) : Infinity,
      fixedMain: 0,
      crossUsed: 0,
      totalFlex: 0,
      totalBasis: 0,
      sizes: new Map(),
      under: new Map(),
      shrunkCap: new Map(),
      sharedCap: new Map(),
      shrunkBasis: new Map(),
    };

    measureLine(line);
    shrinkLine(line);
    const leftover = mainAvail - line.fixedMain - line.totalBasis - totalGap;
    // A flex child on an UNBOUNDED main axis has no leftover space to claim. It must collapse to zero,
    // never to `Infinity`: an infinite extent would become the offset of every following sibling and get
    // written into the content stream verbatim, silently corrupting the page from that point on.
    const remaining = Number.isFinite(leftover) ? Math.max(leftover, 0) : 0;
    const weight = shareLeftover(line, remaining);
    const spacing = mainSpacing(
      mainAlignOf(options),
      gap,
      ordered.length,
      mainAvail,
      leftover,
      weight,
    );
    measureFlex(line, weight, remaining);
    // The cross extent children align within: the bounded line size, else the tallest child.
    const crossExtent = crossAvail !== Infinity && !crossFromContent ? crossAvail : line.crossUsed;
    return placeLine(
      line,
      options.cross ?? "stretch",
      crossExtent,
      crossOrigin,
      spacing,
      weight,
      remaining,
      mode,
    );
  }
}

/** One flex line while it is being settled: what the steps below have measured so far. */
interface FlexLine {
  readonly children: PDFElement[];
  readonly axis: FlexAxis;
  readonly mainAvail: number;
  readonly crossAvail: number;
  readonly ctx: LayoutContext;
  readonly totalGap: number;
  readonly percentBase: number;
  /** Main extent of the fixed children, and the tallest cross extent measured. */
  fixedMain: number;
  crossUsed: number;
  /** The flex children's `flex` and `basis`, summed. */
  totalFlex: number;
  totalBasis: number;
  /** Each child's measured size and the constraints it answers, so placing can reuse it. */
  readonly sizes: Map<PDFElement, Size>;
  readonly under: Map<PDFElement, BoxConstraints>;
  /** Main caps set by the shrink and by the share; a shrunk cap wins. */
  readonly shrunkCap: Map<PDFElement, number>;
  readonly sharedCap: Map<PDFElement, number>;
  /** A flex child's basis after the shrink, when it gave some back. */
  readonly shrunkBasis: Map<PDFElement, number>;
}

/** A flex child's basis on this line: what it asked for, or less once the line has shrunk it. */
function basisOf(line: FlexLine, child: PDFElement, flexible: FlexiblePDFElement): number {
  return line.shrunkBasis.get(child) ?? flexible.getBasis(line.percentBase);
}

/**
 * The main cap to hand a child: its shrunk or shared cap once the line is settled; `percentBase` for a
 * percentage child, so its fraction resolves; unbounded for everyone else, who keep their natural size.
 */
function mainCapFor(line: FlexLine, child: PDFElement): number {
  const target = line.shrunkCap.get(child) ?? line.sharedCap.get(child);
  if (target !== undefined) return target;
  if (line.percentBase === Infinity) return Infinity;
  return child.relativeSizeFactor(line.axis.mainHorizontal) !== undefined
    ? line.percentBase
    : Infinity;
}

/** Measures `child` and remembers the size with the constraints it answers. */
function measureInto(line: FlexLine, child: PDFElement, constraints: BoxConstraints): Size {
  const size = child.measure(constraints, line.ctx);
  line.sizes.set(child, size);
  line.under.set(child, constraints);
  return size;
}

/** Measures a fixed child again at a new main cap, moving the line's totals with it. */
function remeasure(line: FlexLine, child: PDFElement, cap: number): void {
  const before = line.axis.mainOf(line.sizes.get(child)!);
  const size = measureInto(line, child, line.axis.measureConstraints(line.crossAvail, cap));
  line.fixedMain += line.axis.mainOf(size) - before;
  line.crossUsed = Math.max(line.crossUsed, line.axis.crossOf(size));
}

/**
 * Step 1: measure the fixed children (main extent + cross size) and total the flex. A flex child's BASIS
 * is reserved here too: it is main extent the leftover no longer contains, exactly like a fixed child's
 * size. With the default basis of 0 it adds nothing.
 */
function measureLine(line: FlexLine): void {
  const { axis } = line;
  for (const child of line.children) {
    const flexible = flexibleOf(child);
    if (flexible) {
      line.totalFlex += flexible.getFlex();
      line.totalBasis += flexible.getBasis(line.percentBase);
      continue;
    }
    const size = measureInto(
      line,
      child,
      axis.measureConstraints(line.crossAvail, mainCapFor(line, child)),
    );
    line.fixedMain += axis.mainOf(size);
    line.crossUsed = Math.max(line.crossUsed, axis.crossOf(size));
  }
}

/**
 * Step 2: the line overflows and some children said they would give space back. CSS weights a shrinker's
 * share by `shrink x its own size`, so a big item yields more than a small one - for a flex child that
 * size is its basis, so a Spacer (basis 0) gives nothing. A document that never overflows never gets past
 * the first test.
 */
function shrinkLine(line: FlexLine): void {
  const { axis } = line;
  const overflow = line.fixedMain + line.totalBasis + line.totalGap - line.mainAvail;
  if (!Number.isFinite(line.mainAvail) || !(overflow > 0)) return;
  const shrinkers = line.children.filter((c) => {
    if (!(flexShrinkOf(c) > 0)) return false;
    const flexible = flexibleOf(c);
    return !flexible || flexible.getBasis(line.percentBase) > 0;
  });
  if (shrinkers.length === 0) return;

  // Every child is floored at what it can actually hold - its `min-content` extent, which is CSS's
  // automatic `min-width` on a flex item. Without it a badly overflowing line would grind a paragraph
  // down to one word per line. Past that floor a child overflows again, as in a browser.
  const naturalOf = (c: PDFElement) => {
    const flexible = flexibleOf(c);
    return flexible ? flexible.getBasis(line.percentBase) : axis.mainOf(line.sizes.get(c)!);
  };
  const floorOf = new Map<PDFElement, number>(
    shrinkers.map((c) => [
      c,
      // Never above its natural size (the shrink only takes space away) and never below zero (when the
      // GAPS alone outgrow the line, a proportional share asks for more than a child has).
      Math.min(naturalOf(c), Math.max(0, c.minIntrinsicMain(axis.mainHorizontal, line.ctx))),
    ]),
  );

  // CSS resolves this iteratively (Flexbox 9.7): a child that lands on its floor is FROZEN there and the
  // share it could not absorb is handed to the rest. A single pass would leave that share unspent.
  const target = new Map<PDFElement, number>(shrinkers.map((c) => [c, naturalOf(c)]));
  const frozen = new Set<PDFElement>();
  let flexible = [...shrinkers];
  // What the frozen ones took off the overflow; the rest is always shared out from scratch.
  let absorbedByFrozen = 0;
  while (flexible.length > 0) {
    const toAbsorb = overflow - absorbedByFrozen;
    if (toAbsorb <= 1e-9) break;
    const weight = (c: PDFElement) => flexShrinkOf(c) * naturalOf(c);
    const totalWeight = flexible.reduce((n, c) => n + weight(c), 0);
    if (totalWeight <= 0) break;
    const froze: PDFElement[] = [];
    for (const child of flexible) {
      const natural = naturalOf(child);
      const floor = floorOf.get(child)!;
      const wanted = natural - (weight(child) / totalWeight) * toAbsorb;
      if (wanted < floor) {
        target.set(child, floor);
        froze.push(child);
        absorbedByFrozen += natural - floor;
      } else {
        target.set(child, wanted);
      }
    }
    if (froze.length === 0) break;
    for (const c of froze) frozen.add(c);
    flexible = flexible.filter((c) => !frozen.has(c));
  }

  for (const child of shrinkers) {
    const capped = target.get(child)!;
    if (capped >= naturalOf(child)) continue;
    if (flexibleOf(child)) {
      // A flex child is measured later, at its basis plus its share; it starts from less.
      line.totalBasis -= naturalOf(child) - capped;
      line.shrunkBasis.set(child, capped);
      continue;
    }
    line.shrunkCap.set(child, capped);
    // Re-measured NOW: a narrower child may wrap to more lines, and the line's cross extent is
    // settled before anything is placed.
    remeasure(line, child, capped);
  }
}

/**
 * Step 3: a stack holding a Spacer grows like an `Expanded` of flex 1 whose basis is its content - it
 * shares what is left with the flex children. Handing it the whole line squeezed its siblings; handing
 * it a share before the line was settled could leave it less than its own content. Returns the total
 * weight the leftover is shared by.
 */
function shareLeftover(line: FlexLine, remaining: number): number {
  const { axis } = line;
  const sharing = line.children.filter(
    (child) =>
      line.percentBase !== Infinity &&
      !flexibleOf(child) &&
      child.relativeSizeFactor(axis.mainHorizontal) === undefined &&
      child.needsBoundedMain(axis.mainHorizontal),
  );
  const weight = line.totalFlex + sharing.length;
  if (remaining > 0) {
    for (const child of sharing) {
      const grown = axis.mainOf(line.sizes.get(child)!) + remaining / weight;
      line.sharedCap.set(child, grown);
      remeasure(line, child, grown);
    }
  }
  return weight;
}

/** Step 4: the main-axis distribution - only with nothing to flex and bounded, positive space. */
function mainSpacing(
  main: MainAlign,
  gap: number,
  count: number,
  mainAvail: number,
  leftover: number,
  weight: number,
): { leading: number; between: number } {
  if (weight !== 0 || mainAvail === Infinity || !(leftover > 0))
    return { leading: 0, between: gap };
  if (main === "center") return { leading: leftover / 2, between: gap };
  if (main === "end") return { leading: leftover, between: gap };
  if (main === "between" && count > 1) return { leading: 0, between: gap + leftover / (count - 1) };
  if (main === "around") {
    const unit = leftover / count;
    return { leading: unit / 2, between: gap + unit };
  }
  return { leading: 0, between: gap };
}

/**
 * Step 5: measure the flex children at their share, so a tall or wrapping flex cell counts toward the
 * line's cross extent before anything is placed.
 */
function measureFlex(line: FlexLine, weight: number, remaining: number): void {
  for (const child of line.children) {
    const flexible = flexibleOf(child);
    if (!flexible) continue;
    // A pure `flexBasis` slot (`flex: 0`) has no share but still has a size across the line.
    const share = weight > 0 ? (flexible.getFlex() / weight) * remaining : 0;
    const mainExtent = basisOf(line, child, flexible) + share;
    const size = measureInto(line, child, line.axis.flexConstraints(mainExtent, line.crossAvail));
    line.crossUsed = Math.max(line.crossUsed, line.axis.crossOf(size));
  }
}

/**
 * Step 6: place each child at the running main position, offset across by its alignment. This is the
 * ONE layout a child gets. Measuring, it only sizes - and reuses a size already measured under the same
 * constraints, or the measuring itself would double at every level.
 *
 * `stretch` caps a child's cross to `crossExtent`, not `crossAvail`, so siblings end up equal across the
 * axis. A child may override the container with its own `alignSelf` (CSS).
 */
function placeLine(
  line: FlexLine,
  cross: CrossAlign,
  crossExtent: number,
  crossOrigin: number,
  spacing: { leading: number; between: number },
  weight: number,
  remaining: number,
  mode: FlexMode,
): { mainUsed: number; crossUsed: number } {
  const { axis, ctx } = line;
  const place = (child: PDFElement, constraints: BoxConstraints, offset: Offset): Size => {
    if (mode === "layout") return child.calculateLayout(constraints, offset, ctx);
    const known = line.under.get(child);
    return known && sameConstraints(known, constraints)
      ? line.sizes.get(child)!
      : child.measure(constraints, ctx);
  };
  const last = line.children.length - 1;
  let mainPos = spacing.leading;
  let placedCross = 0;
  line.children.forEach((child, index) => {
    let mainExtent: number;
    const flexible = flexibleOf(child);
    if (flexible) {
      // `totalFlex` is 0 when every flex child asked for `flex: 0` (a pure `flexBasis` slot). The share
      // is then 0/0 - a NaN that becomes the offset of every later sibling. Such a child takes its basis.
      const share = weight > 0 ? (flexible.getFlex() / weight) * remaining : 0;
      mainExtent = basisOf(line, child, flexible) + share;
      // A flex child fills the MAIN axis and its cross size is only known after layout, so `alignSelf`
      // is a no-op here - and that has to hold for the CROSS CONSTRAINT too, or an `alignSelf: "start"`
      // flex child would get an unbounded cross axis on a shrink-wrapping line.
      const size = place(
        child,
        axis.flexConstraints(mainExtent, cross === "stretch" ? crossExtent : line.crossAvail),
        axis.offsetAt(mainPos, crossOrigin),
      );
      placedCross = Math.max(placedCross, axis.crossOf(size));
    } else {
      const align = alignSelfOf(child) ?? cross;
      const childCross = axis.crossOf(line.sizes.get(child)!);
      const size = place(
        child,
        axis.measureConstraints(
          align === "stretch" ? crossExtent : line.crossAvail,
          mainCapFor(line, child),
        ),
        axis.offsetAt(mainPos, crossOrigin + crossOffset(align, crossExtent, childCross)),
      );
      mainExtent = axis.mainOf(size);
      placedCross = Math.max(placedCross, axis.crossOf(size));
    }
    mainPos += mainExtent;
    if (index < last) mainPos += spacing.between;
  });
  return { mainUsed: mainPos, crossUsed: placedCross };
}

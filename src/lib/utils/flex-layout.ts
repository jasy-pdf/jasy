import { PDFElement, LayoutContext, FlexiblePDFElement } from "../elements/pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";

/** Distribution of the children ALONG the stacking (main) axis when there is leftover
 *  space and no flex child to absorb it. */
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
  /** Absolute offset for a child at main position `mainPos`, cross position `crossPos`. */
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
  const ordered = children.some((c) => c.order !== 0)
    ? [...children].sort((a, b) => a.order - b.order)
    : children;
  return reverse ? [...ordered].reverse() : ordered;
}

export class FlexLayoutHelper {
  /**
   * Lays out a flex line along `axis`, IN SOURCE ORDER, and places every child.
   * Fixed children take their natural main extent; flex (`ExpandedElement`) children
   * split the leftover main space by their `flex`. `gap` is inserted between children.
   * `main` distributes any leftover when there is no flex child; `cross` positions/sizes
   * each child across the line. Returns the total main extent consumed and the cross
   * extent occupied. Vertical with `gap 0`, `main start`, `cross stretch` reproduces the
   * previous Column layout exactly.
   */
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
    mainStart: number,
    crossOrigin: number,
    options: FlexOptions,
    ctx: LayoutContext,
  ): { mainUsed: number; crossUsed: number } {
    if (!options.wrap || children.length === 0 || !Number.isFinite(mainAvail)) {
      // An unbounded main axis has no edge to wrap at, so wrapping there is meaningless, not an error.
      return FlexLayoutHelper.layoutLine(
        children,
        axis,
        mainAvail,
        crossAvail,
        mainStart,
        crossOrigin,
        options,
        ctx,
      );
    }
    return FlexLayoutHelper.layoutWrapped(
      children,
      axis,
      mainAvail,
      crossAvail,
      mainStart,
      crossOrigin,
      options,
      ctx,
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
    mainStart: number,
    crossOrigin: number,
    options: FlexOptions,
    ctx: LayoutContext,
  ): { mainUsed: number; crossUsed: number } {
    const gap = options.gap ?? 0;
    const ordered = inLayoutOrder(children, options.reverse ?? false);

    // Which children share a line. A child is measured at its natural main extent; a flex child
    // contributes its BASIS, which is 0 unless it asked for one - so it never forces a break by itself.
    // A child's natural main extent. A PERCENTAGE child has no fixed answer: its size depends on how
    // many gaps the line ends up with, which depends on who is on it. So it is asked again for every
    // candidate membership below rather than measured once.
    const naturalMain = (child: PDFElement, base: number): number => {
      if (child instanceof FlexiblePDFElement) return child.getBasis(base);
      const factor = child.relativeSizeFactor(axis.mainHorizontal);
      if (factor !== undefined) return base * factor;
      // Measured UNCAPPED, the same way the single-line engine measures a plain child. Handing the
      // line width in as a cap would silently squash a child wider than the line - CSS lets such a
      // child overflow, and so does our own non-wrapping path.
      const needsBound = child.needsBoundedMain(axis.mainHorizontal);
      return axis.mainOf(
        child.calculateLayout(
          axis.measureConstraints(crossAvail, needsBound ? mainAvail : Infinity),
          axis.offsetAt(mainStart, crossOrigin),
          ctx,
        ),
      );
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
    const lineOptions = { ...options, wrap: false, reverse: false };
    const measure = lines.map((line) =>
      FlexLayoutHelper.layoutLine(
        line,
        axis,
        mainAvail,
        Infinity, // let each line report the cross extent it actually needs
        mainStart,
        crossOrigin,
        lineOptions,
        ctx,
      ),
    );

    const heights = measure.map((m) => m.crossUsed);
    const totalCross = heights.reduce((n, h) => n + h, 0) + Math.max(0, lines.length - 1) * gap;

    // `alignContent` distributes the BLOCK of lines across the axis, using the same vocabulary the main
    // axis uses. Only meaningful in a bounded cross axis with room left over.
    const slack = Number.isFinite(crossAvail) ? crossAvail - totalCross : 0;
    const align = options.alignContent ?? "start";
    let cursor = crossOrigin;
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
        mainStart,
        cursor,
        lineOptions,
        ctx,
      );
      cursor += heights[i];
      if (i < lines.length - 1) cursor += between;
    });

    return { mainUsed: mainAvail, crossUsed: Math.max(totalCross, cursor - crossOrigin) };
  }

  private static layoutLine(
    children: PDFElement[],
    axis: FlexAxis,
    mainAvail: number,
    crossAvail: number,
    mainStart: number,
    crossOrigin: number,
    options: FlexOptions,
    ctx: LayoutContext,
  ): { mainUsed: number; crossUsed: number } {
    const gap = options.gap ?? 0;
    const main = options.main ?? "start";
    const cross = options.cross ?? "stretch";
    children = inLayoutOrder(children, options.reverse ?? false);
    const count = children.length;
    const totalGap = Math.max(0, count - 1) * gap;

    // The main extent a percentage child resolves against: the line's own extent minus the gaps
    // between the items. So N children at (100/N)% + gaps fit exactly, instead of overflowing by the
    // gaps (the flexbox `width: 33%` + gap trap). Only finite when the line's main axis is bounded -
    // a fraction of an unbounded main axis has no meaning, so `%` children fall back to shrink-wrap.
    const percentBase = mainAvail !== Infinity ? Math.max(0, mainAvail - totalGap) : Infinity;
    // The main cap to hand a child: `percentBase` for a percentage child (so its fraction resolves) and
    // for a child that cannot lay itself out without a bound (a nested stack holding an `Expanded`/
    // `Spacer`); unbounded for everyone else, who keep their natural size and never fill the line.
    // Filled by the shrink pass below; read by `mainCapFor` in pass 2. Declared here so the closure
    // can see it - it is empty for every document that does not ask for shrinking.
    const shrunkCap = new Map<PDFElement, number>();
    const mainCapFor = (child: PDFElement): number => {
      const target = shrunkCap.get(child);
      if (target !== undefined) return target;
      if (percentBase === Infinity) return Infinity;
      const needsBound =
        child.relativeSizeFactor(axis.mainHorizontal) !== undefined ||
        child.needsBoundedMain(axis.mainHorizontal);
      return needsBound ? percentBase : Infinity;
    };

    // Pass 1: measure the fixed children (main extent + cross size) and total the flex.
    // A flex child's BASIS is reserved here too: it is main extent the leftover no longer contains,
    // exactly like a fixed child's size. With the default basis of 0 this line adds nothing.
    let fixedMain = 0;
    let totalFlex = 0;
    let totalBasis = 0;
    let crossUsed = 0;
    const fixedSize = new Map<PDFElement, Size>();
    for (const child of children) {
      if (child instanceof FlexiblePDFElement) {
        totalFlex += child.getFlex();
        totalBasis += child.getBasis(percentBase);
      } else {
        const size = child.calculateLayout(
          axis.measureConstraints(crossAvail, mainCapFor(child)),
          axis.offsetAt(mainStart, crossOrigin),
          ctx,
        );
        fixedMain += axis.mainOf(size);
        crossUsed = Math.max(crossUsed, axis.crossOf(size));
        fixedSize.set(child, size);
      }
    }

    // Shrinking: the line overflows and some children said they would give space back. CSS weights a
    // shrinker's share by `shrink x its own size`, so a big item yields more than a small one - which is
    // why this cannot reuse the grow maths above. Nobody shrinks by default, so a document that never
    // asks for it never enters this block.
    const shrinkers = children.filter(
      (c) => c.flexShrink > 0 && !(c instanceof FlexiblePDFElement),
    );
    const overflow = fixedMain + totalBasis + totalGap - mainAvail;
    if (shrinkers.length > 0 && Number.isFinite(mainAvail) && overflow > 0) {
      const weight = (c: PDFElement) => c.flexShrink * axis.mainOf(fixedSize.get(c)!);
      const totalWeight = shrinkers.reduce((n, c) => n + weight(c), 0);
      if (totalWeight > 0) {
        for (const child of shrinkers) {
          const natural = axis.mainOf(fixedSize.get(child)!);
          // Never below zero: when the GAPS alone outgrow the line, a proportional share asks for more
          // than a child has. No test can tell this clamp apart from its absence - `constrainWidth`
          // floors at 0 further down either way - but handing out a negative constraint is nonsense,
          // and the next reader should not have to work out that it happens to be harmless.
          const target = Math.max(0, natural - (weight(child) / totalWeight) * overflow);
          shrunkCap.set(child, target);
          // Re-measure NOW, not in pass 2: a narrower child may wrap to more lines, and the line's
          // cross extent is settled just below.
          const size = child.calculateLayout(
            axis.measureConstraints(crossAvail, target),
            axis.offsetAt(mainStart, crossOrigin),
            ctx,
          );
          fixedMain += axis.mainOf(size) - natural;
          crossUsed = Math.max(crossUsed, axis.crossOf(size));
          fixedSize.set(child, size);
        }
      }
    }

    const leftover = mainAvail - fixedMain - totalBasis - totalGap;
    // A flex child on an UNBOUNDED main axis has no leftover space to claim. It must collapse to zero,
    // never to `Infinity`: an infinite extent would become the offset of every following sibling and get
    // written into the content stream verbatim, silently corrupting the page from that point on.
    const remaining = Number.isFinite(leftover) ? Math.max(leftover, 0) : 0;

    // Main-axis distribution only kicks in with no flex child and bounded, positive space.
    let leadingSpace = 0;
    let betweenSpace = gap;
    if (totalFlex === 0 && mainAvail !== Infinity && leftover > 0) {
      if (main === "center") leadingSpace = leftover / 2;
      else if (main === "end") leadingSpace = leftover;
      else if (main === "between" && count > 1) betweenSpace = gap + leftover / (count - 1);
      else if (main === "around") {
        const unit = leftover / count;
        leadingSpace = unit / 2;
        betweenSpace = gap + unit;
      }
    }

    // Measure flex children too (at their main share) so a tall/wrapping flex cell counts
    // toward the line's cross extent - they're placed in pass 2, but crossExtent needs them now.
    if (totalFlex > 0) {
      for (const child of children) {
        if (child instanceof FlexiblePDFElement) {
          const mainExtent =
            child.getBasis(percentBase) + (child.getFlex() / totalFlex) * remaining;
          const size = child.calculateLayout(
            axis.flexConstraints(mainExtent, crossAvail),
            axis.offsetAt(mainStart, crossOrigin),
            ctx,
          );
          crossUsed = Math.max(crossUsed, axis.crossOf(size));
        }
      }
    }

    // The cross extent children align within: the bounded line size, else the tallest child.
    const crossExtent = crossAvail !== Infinity ? crossAvail : crossUsed;

    // `stretch` caps a child's cross to `crossExtent` (not `crossAvail`) so siblings end up
    // equal across the axis. Bounded lines have crossExtent == crossAvail (byte-identical);
    // only an unbounded line (a shrink-wrap Row) now equalises instead of staying natural.
    // A child may override the container with its own `alignSelf` (CSS), so the decision is per child.
    const alignFor = (child: PDFElement): CrossAlign => child.alignSelf ?? cross;

    // Pass 2: place each child at the running main position, offset across by its alignment.
    let mainPos = mainStart + leadingSpace;
    let placedCross = 0;
    children.forEach((child, index) => {
      const align = alignFor(child);
      const stretch = align === "stretch";
      let mainExtent: number;
      if (child instanceof FlexiblePDFElement) {
        mainExtent = child.getBasis(percentBase) + (child.getFlex() / totalFlex) * remaining;
        // A flex child fills the MAIN axis, and its cross size is only known after layout - there is
        // nothing to align against. So alignSelf is a no-op here, and that has to hold for the CROSS
        // CONSTRAINT too: reading the per-child alignment would hand an `alignSelf: "start"` flex child
        // an unbounded cross axis on a shrink-wrapping line, where the container's own rule gives it
        // the line's extent. A no-op that changes the constraints is not a no-op.
        const size = child.calculateLayout(
          axis.flexConstraints(mainExtent, cross === "stretch" ? crossExtent : crossAvail),
          axis.offsetAt(mainPos, crossOrigin),
          ctx,
        );
        placedCross = Math.max(placedCross, axis.crossOf(size));
      } else {
        const childCross = axis.crossOf(fixedSize.get(child)!);
        const size = child.calculateLayout(
          axis.measureConstraints(stretch ? crossExtent : crossAvail, mainCapFor(child)),
          axis.offsetAt(mainPos, crossOrigin + crossOffset(align, crossExtent, childCross)),
          ctx,
        );
        mainExtent = axis.mainOf(size);
        placedCross = Math.max(placedCross, axis.crossOf(size));
      }
      mainPos += mainExtent;
      if (index < count - 1) mainPos += betweenSpace;
    });

    return { mainUsed: mainPos - mainStart, crossUsed: placedCross };
  }
}

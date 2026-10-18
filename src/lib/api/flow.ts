import { ContainerElement } from "../elements/container-element.ts";
import { FlowElement, type FlowTemplate } from "../elements/layout/flow-element.ts";
import { RegionElement } from "../elements/layout/region-element.ts";
import { ColumnBreakElement } from "../elements/layout/column-break-element.ts";
import { PDFElement } from "../elements/pdf-element.ts";
import { BoundsInput, SizeInput, toBounds, toDimension } from "./dimension.ts";
import { Expanded, Row } from "./layout.ts";

export type { FlowPage, FlowTemplate } from "../elements/layout/flow-element.ts";
export {
  FlowRegionsEmptyError,
  FlowUnboundedError,
  FlowWithoutRegionError,
  RegionInPageBuilderError,
} from "../elements/layout/flow-element.ts";
export { RegionOutsideFlowError, RegionReusedError } from "../elements/layout/region-element.ts";

export interface FlowOptions {
  /** The layout of one page of the Flow, built per page; its `Region`s are where the content goes. */
  template: FlowTemplate;
  /** Space between the content's elements, in points. */
  gap?: number;
}

/**
 * Content flowing through the `Region`s of a template: the first Region full, then the next, then the
 * next page. It takes its height from where it sits - the rest of the page, or a box with a height.
 *
 * @experimental The shape may still change.
 */
export function Flow(opts: FlowOptions, content: PDFElement[]): FlowElement {
  return new FlowElement({
    content: new ContainerElement({ x: 0, y: 0, children: content, gap: opts.gap }),
    template: opts.template,
  });
}

export interface RegionOptions extends BoundsInput {
  width?: SizeInput;
  height?: SizeInput;
}

/**
 * A place in a `Flow`'s template that the content flows through, in tree order. Sized by the layout
 * around it (`Expanded`, `width`, `height`); with nothing given it fills what it is offered.
 *
 * @experimental
 */
export function Region(opts: RegionOptions = {}): RegionElement {
  const w = opts.width !== undefined ? toDimension(opts.width) : undefined;
  const h = opts.height !== undefined ? toDimension(opts.height) : undefined;
  return new RegionElement({
    width: w?.points,
    height: h?.points,
    widthFactor: w?.factor,
    heightFactor: h?.factor,
    ...toBounds(opts),
  })
    .withAlignSelf(opts.alignSelf)
    .withOrder(opts.order)
    .withFlexShrink(opts.flexShrink) as RegionElement;
}

/** Continue in the next `Region` of the Flow it sits in (from the last one, the next page's first). */
export function ColumnBreak(): ColumnBreakElement {
  return new ColumnBreakElement();
}

/** A value as the author wrote it: `"2"` quoted, `NaN` as NaN. */
const shown = (value: unknown) =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

export interface SplitViewOptions {
  /** How many columns, side by side and equally wide (default 2). */
  columns?: number;
  /** Gap between both the columns and the content's elements (default 0). */
  gap?: number;
  /** Gap between the content's elements (overrides `gap`). */
  rowGap?: number;
  /** Gap between the columns (overrides `gap`). */
  colGap?: number;
}

/**
 * Newspaper columns: the content fills the first column, then the next, then the next page. A `Flow`
 * with a ready template - for anything else (a title area, columns of different widths) build your own.
 *
 * @experimental
 */
export function SplitView(opts: SplitViewOptions, content: PDFElement[]): FlowElement {
  const columns = opts.columns ?? 2;
  if (!Number.isInteger(columns) || columns < 1) {
    throw new Error(
      `Invalid SplitView columns ${shown(columns)}: use a whole number of 1 or more.`,
    );
  }
  for (const key of ["gap", "rowGap", "colGap"] as const) {
    const value = opts[key];
    if (value !== undefined && !(Number.isFinite(value) && value >= 0)) {
      throw new Error(
        `Invalid SplitView ${key} ${shown(value)}: use a number of points, 0 or more.`,
      );
    }
  }
  const colGap = opts.colGap ?? opts.gap;
  return Flow(
    {
      gap: opts.rowGap ?? opts.gap,
      template: () =>
        Row(
          { gap: colGap },
          Array.from({ length: columns }, () => Expanded(Region())),
        ),
    },
    content,
  );
}

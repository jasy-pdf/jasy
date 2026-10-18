import { ContainerElement } from "../elements/container-element.ts";
import { FlowElement, type FlowTemplate } from "../elements/layout/flow-element.ts";
import { RegionElement } from "../elements/layout/region-element.ts";
import { ColumnBreakElement } from "../elements/layout/column-break-element.ts";
import { PDFElement } from "../elements/pdf-element.ts";
import { BoundsInput, SizeInput, toBounds, toDimension } from "./dimension.ts";

export type { FlowPage, FlowTemplate } from "../elements/layout/flow-element.ts";
export { FlowUnboundedError, FlowWithoutRegionError } from "../elements/layout/flow-element.ts";
export { RegionOutsideFlowError } from "../elements/layout/region-element.ts";

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
 * @experimental The shape may still change until `SplitView` is built on it.
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

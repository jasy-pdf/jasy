import { FlexiblePDFElement, PDFElement } from "../elements/pdf-element.ts";
import type { CrossAlign } from "./alignment.ts";

/**
 * How a Row or Column sees a child as a flex item. A wrapper that only marks its child (a `Link`, an
 * `Anchor`, a `DefaultTextStyle` - see `PDFElement.proxied`) is looked through, as CSS
 * `display: contents` is: an `Expanded`, `alignSelf`, `order` or `flexShrink` inside it acts as if the
 * wrapper were not there. A value set on the wrapper itself wins over one set inside it.
 */

/**
 * The child, then each element it is transparent for, outermost first. An `Expanded` is one of them:
 * `Expanded(child)` is `flex: 1` on the child, so the child's `alignSelf` and `order` are the item's.
 */
function* itemChain(child: PDFElement): Generator<PDFElement> {
  for (let el: PDFElement | undefined = child; el; ) {
    yield el;
    el = el.proxied() ?? (el instanceof FlexiblePDFElement ? el.layoutChildren()[0] : undefined);
  }
}

/** The `Expanded`/`Spacer` that makes this child flexible, if any. */
export function flexibleOf(child: PDFElement): FlexiblePDFElement | undefined {
  for (const el of itemChain(child)) if (el instanceof FlexiblePDFElement) return el;
  return undefined;
}

export function alignSelfOf(child: PDFElement): CrossAlign | undefined {
  for (const el of itemChain(child)) if (el.alignSelf !== undefined) return el.alignSelf;
  return undefined;
}

/** CSS `order`, 0 when unset. */
export function orderOf(child: PDFElement): number {
  for (const el of itemChain(child)) if (el.order !== undefined) return el.order;
  return 0;
}

/** The child is a `Box` with percentage padding. */
export function hasPercentPaddingItem(child: PDFElement): boolean {
  for (const el of itemChain(child)) if (el.hasPercentPadding()) return true;
  return false;
}

/** CSS `flex-shrink`, 1 when unset (the CSS default). */
export function flexShrinkOf(child: PDFElement): number {
  for (const el of itemChain(child)) if (el.flexShrink !== undefined) return el.flexShrink;
  return 1;
}

import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, PDFElement } from "../pdf-element.ts";

/**
 * A forced page break. Placed in a flow (a `Column`/`Row`/`Box`), it makes everything AFTER it start
 * on a fresh page, no matter how much space is left. It takes zero space and draws nothing - the
 * pagination packer consumes it at the cut, so it never reaches the render pass.
 *
 * Nesting works: a break deep inside a container is honoured because the packer fragments any child
 * whose subtree `hasForcedBreak()`, and the resulting `forceBreak` bubbles up so the outer flow stops
 * too. A break wins over a `keepTogether` (a forced break cannot be avoided) - CSS behaves the same.
 */
export class PageBreakElement extends PDFElement {
  calculateLayout(_constraints: BoxConstraints, _offset: Offset, _ctx: LayoutContext): Size {
    return { width: 0, height: 0 };
  }

  override isPageBreak(): boolean {
    return true;
  }

  override hasForcedBreak(): boolean {
    return true;
  }

  override getProps(): Record<string, never> {
    return {};
  }
}

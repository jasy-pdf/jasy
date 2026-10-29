import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { LayoutContext, PDFElement } from "../pdf-element.ts";
import { pageOf } from "../../common/diagnostics.ts";

/**
 * A forced break to the next Region of a `Flow` - from the last one, the next page's first. Always of
 * the innermost Flow; several skip several. It takes no space and draws nothing: the packer of a Region
 * consumes it, so reaching the render pass means it sat outside one, which is reported there.
 */
export class ColumnBreakElement extends PDFElement {
  /** The page it was last laid out on - only so an ineffective break can name it. */
  page?: number;

  calculateLayout(_constraints: BoxConstraints, _offset: Offset, ctx: LayoutContext): Size {
    this.page = pageOf(ctx);
    return { width: 0, height: 0 };
  }

  protected override computeSize(): Size {
    return { width: 0, height: 0 };
  }

  override isColumnBreak(): boolean {
    return true;
  }

  /** So a container around it is packed (and the break found) instead of placed whole. */
  override hasForcedBreak(): boolean {
    return true;
  }

  override getProps(): Record<string, never> {
    return {};
  }
}

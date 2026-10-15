import { PDFElement, LayoutContext, WithChild } from "../pdf-element.ts";
import { ProxyElement } from "./proxy-element.ts";
import { DEFAULT_TEXT_STYLE, ResolvedTextStyle, mergeTextStyle } from "../../text/text-style.ts";

interface DefaultTextStyleParams extends WithChild {
  style: Partial<ResolvedTextStyle>;
}

/**
 * Provides default text properties (font/size/color/lineHeight/align/weight) to its whole subtree -
 * Flutter's `DefaultTextStyle`. Transparent to layout (a `ProxyElement`): only the inherited
 * TextStyle changes. A `Text` below still wins per property, and these
 * overrides layer onto whatever the element already inherited from above.
 */
export class DefaultTextStyleElement extends ProxyElement {
  private style: Partial<ResolvedTextStyle>;

  constructor({ child, style }: DefaultTextStyleParams) {
    super(child);
    this.style = style;
  }

  protected override childContext(ctx: LayoutContext): LayoutContext {
    return { ...ctx, textStyle: this.mergedOnto(ctx.textStyle ?? DEFAULT_TEXT_STYLE) };
  }

  // The same inherited style gives back the SAME merged object: the layout cache compares context
  // values by identity, so a fresh merge per call would make everything below miss.
  private merged?: { onto: ResolvedTextStyle; style: ResolvedTextStyle };
  private mergedOnto(inherited: ResolvedTextStyle): ResolvedTextStyle {
    if (this.merged?.onto !== inherited) {
      this.merged = { onto: inherited, style: mergeTextStyle(inherited, this.style) };
    }
    return this.merged.style;
  }

  // Each piece of a split keeps the defaults, so the remainder on the next page looks the same.
  protected override rewrap(child: PDFElement): PDFElement {
    return new DefaultTextStyleElement({ child, style: this.style });
  }

  override getProps() {
    return { x: this.x, y: this.y, width: this.width, height: this.height, child: this.child };
  }
}

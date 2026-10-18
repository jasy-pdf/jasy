import type { Offset } from "../layout/box-constraints.ts";
import type { IRNode } from "../ir/display-list.ts";
import type { PDFObjectManager } from "./pdf-object-manager.ts";

/**
 * Where an element is drawn. `origin` is the ABSOLUTE top-left that the element's own offset is
 * relative to; a renderer adds it to its position and hands its children the origin THEY are relative
 * to. `frame` is the absolute top-left of the nearest positioning frame (the page's content box, or a
 * `relative` Box): a `Positioned` is laid out relative to it and draws from there, at its own place in
 * the tree - tree order is paint order.
 */
export interface RenderScope {
  origin: Offset;
  frame: Offset;
}

/** The scope for the children of an element at `offset` (relative to `scope.origin`). */
export function within(scope: RenderScope, offset: { x?: number; y?: number }): RenderScope {
  return {
    ...scope,
    origin: { x: scope.origin.x + (offset.x ?? 0), y: scope.origin.y + (offset.y ?? 0) },
  };
}

/**
 * Renders one element to IR. Typed so that a call which forgets to pass the scope on does not
 * compile - a forgotten origin draws at the page corner without a word.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementRenderer = (
  element: any,
  objectManager: PDFObjectManager,
  scope: RenderScope,
) => Promise<IRNode[]>;

/**
 * Thrown when an element reaches the render pass with no registered renderer.
 *
 * This used to return undefined and every call site skipped the element silently, so a whole document
 * could serialize to an empty content stream and still be a valid PDF - a blank page, no warning
 * (ISSUE-11). The registry is keyed on the CONSTRUCTOR, which makes it the one place in the engine that
 * two loaded copies of the library break: elements built by copy A are invisible to copy B.
 */
export class MissingRendererError extends Error {
  constructor(readonly elementName: string) {
    super(
      `@jasy/pdf: no renderer registered for "${elementName}". Either the element was never registered ` +
        `in PDFRenderer.render(), or two copies of @jasy/pdf are loaded - the registry is keyed on the ` +
        `element's constructor, so elements built by one copy cannot be rendered by the other. ` +
        `Check the dependency tree for a duplicate (e.g. \`pnpm why @jasy/pdf\`).`,
    );
  }
}

/**
 * Thrown when one element INSTANCE is drawn twice on the same page. An element holds one position - the
 * place its last layout gave it - so both copies would land there and one would silently go missing.
 */
export class ElementReusedError extends Error {
  constructor(readonly elementName: string) {
    super(
      `@jasy/pdf: the same ${elementName} element is used twice on one page. An element has ONE ` +
        `position, so both copies would be drawn in the same place. Create it twice instead - call the ` +
        `factory again (e.g. a function \`const divider = () => Divider()\`) or place \`element.clone()\`.`,
    );
  }
}

export class RendererRegistry {
  private static renderers = new Map<Function, ElementRenderer>();
  // What each document has drawn on its current page (keyed per document: two can render at once).
  private static drawnOnPage = new WeakMap<PDFObjectManager, WeakSet<object>>();

  static register(elementClass: Function, renderer: ElementRenderer) {
    if (!RendererRegistry.renderers.has(elementClass)) {
      RendererRegistry.renderers.set(elementClass, renderer);
    }
  }
  // Keyed on the element's constructor, so it only needs an object - not `any`.
  // Throws rather than returning undefined: a missing renderer is always a bug, and skipping it drew nothing.
  static getRenderer(element: object): ElementRenderer {
    const renderer = RendererRegistry.renderers.get(element.constructor);
    if (!renderer) throw new MissingRendererError(element.constructor.name);
    return renderer;
  }
  /** A new page starts for this document: nothing is drawn on it yet. */
  static beginPage(objectManager: PDFObjectManager): void {
    RendererRegistry.drawnOnPage.set(objectManager, new WeakSet());
  }

  /**
   * Draws `element` with its renderer. Every draw goes through here, so it is where reuse is caught - for
   * an element that DRAWS something: one that draws nothing (a Spacer) has no place to land wrongly, and
   * reusing it stays harmless.
   */
  static async render(
    element: object,
    objectManager: PDFObjectManager,
    scope: RenderScope,
  ): Promise<IRNode[]> {
    const nodes = await RendererRegistry.getRenderer(element)(element, objectManager, scope);
    const drawn = RendererRegistry.drawnOnPage.get(objectManager);
    if (drawn && nodes.length > 0) {
      if (drawn.has(element)) throw new ElementReusedError(element.constructor.name);
      drawn.add(element);
    }
    return nodes;
  }

  static isRendererAsync(renderer: Function): boolean {
    return renderer.constructor.name === "AsyncFunction";
  }
}

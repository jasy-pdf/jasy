import type { Offset } from "../layout/box-constraints.ts";
import type { IRNode } from "../ir/display-list.ts";
import type { PDFObjectManager } from "./pdf-object-manager.ts";

/**
 * Renders one element to IR. `origin` is the ABSOLUTE top-left that the element's own offset is
 * relative to; a renderer adds it to its position and hands its children the origin THEY are relative
 * to. Typed so that a call which forgets to pass it on does not compile - a forgotten origin draws at
 * the page corner without a word.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ElementRenderer = (
  element: any,
  objectManager: PDFObjectManager,
  origin: Offset,
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

export class RendererRegistry {
  private static renderers = new Map<Function, ElementRenderer>();

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
  static isRendererAsync(renderer: Function): boolean {
    return renderer.constructor.name === "AsyncFunction";
  }
}

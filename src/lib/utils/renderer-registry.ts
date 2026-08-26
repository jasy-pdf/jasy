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
  private static renderers = new Map<Function, Function>();

  static register(elementClass: Function, renderer: Function) {
    if (!RendererRegistry.renderers.has(elementClass)) {
      RendererRegistry.renderers.set(elementClass, renderer);
    }
  }
  // Keyed on the element's constructor, so it only needs an object - not `any`.
  // Throws rather than returning undefined: a missing renderer is always a bug, and skipping it drew nothing.
  static getRenderer(element: object): Function {
    const renderer = RendererRegistry.renderers.get(element.constructor);
    if (!renderer) throw new MissingRendererError(element.constructor.name);
    return renderer;
  }
  static isRendererAsync(renderer: Function): boolean {
    return renderer.constructor.name === "AsyncFunction";
  }
}

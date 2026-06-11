export class RendererRegistry {
  private static renderers = new Map<Function, Function>();

  static register(elementClass: Function, renderer: Function) {
    if (!RendererRegistry.renderers.has(elementClass)) {
      RendererRegistry.renderers.set(elementClass, renderer);
    }
  }
  // Keyed on the element's constructor, so it only needs an object - not `any`.
  static getRenderer(element: object): Function | undefined {
    return RendererRegistry.renderers.get(element.constructor);
  }
  static isRendererAsync(renderer: Function): boolean {
    return renderer.constructor.name === "AsyncFunction";
  }
}

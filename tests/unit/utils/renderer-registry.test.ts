import { describe, it, expect } from "vitest";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry";

// Beispiel-Renderer-Funktion
const exampleRenderer = () => "Rendered";
const asyncRenderer = async () => "Rendered Async";

// Beispiel-Element-Klassen
class ExampleElement {}
class AsyncElement {}

describe("RendererRegistry", () => {
  it("should register a renderer for an element class", () => {
    RendererRegistry.register(ExampleElement, exampleRenderer);
    const renderer = RendererRegistry.getRenderer(new ExampleElement());

    expect(renderer).toBe(exampleRenderer);
  });

  it("should return undefined if no renderer is registered for an element", () => {
    const renderer = RendererRegistry.getRenderer({});

    expect(renderer).toBeUndefined();
  });

  it("should check if a renderer is async", () => {
    RendererRegistry.register(AsyncElement, asyncRenderer);
    const renderer = RendererRegistry.getRenderer(new AsyncElement());

    const isAsync = RendererRegistry.isRendererAsync(renderer!);
    expect(isAsync).toBe(true);
  });

  it("should return false for non-async renderer", () => {
    RendererRegistry.register(ExampleElement, exampleRenderer);
    const renderer = RendererRegistry.getRenderer(new ExampleElement());

    const isAsync = RendererRegistry.isRendererAsync(renderer!);
    expect(isAsync).toBe(false);
  });
});

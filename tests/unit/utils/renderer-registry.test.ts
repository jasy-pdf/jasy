import { describe, it, expect } from "vitest";
import {
  RendererRegistry,
  MissingRendererError,
} from "../../../src/lib/utils/renderer-registry.ts";

const exampleRenderer = () => "Rendered";
const asyncRenderer = async () => "Rendered Async";

class ExampleElement {}
class AsyncElement {}
class UnregisteredElement {}

describe("RendererRegistry", () => {
  it("should register a renderer for an element class", () => {
    RendererRegistry.register(ExampleElement, exampleRenderer);
    const renderer = RendererRegistry.getRenderer(new ExampleElement());

    expect(renderer).toBe(exampleRenderer);
  });

  // Returning undefined here is what let a whole document render blank: every call site skipped the
  // element without a word (ISSUE-11). A missing renderer is always a bug, so it has to be loud.
  it("throws for an element with no registered renderer", () => {
    expect(() => RendererRegistry.getRenderer(new UnregisteredElement())).toThrow(
      MissingRendererError,
    );
  });

  it("names the element and points at the duplicate-copy cause", () => {
    expect(() => RendererRegistry.getRenderer(new UnregisteredElement())).toThrow(
      /UnregisteredElement.*two copies of @jasy\/pdf/s,
    );
  });

  it("should check if a renderer is async", () => {
    RendererRegistry.register(AsyncElement, asyncRenderer);
    const renderer = RendererRegistry.getRenderer(new AsyncElement());

    expect(RendererRegistry.isRendererAsync(renderer)).toBe(true);
  });

  it("should return false for non-async renderer", () => {
    RendererRegistry.register(ExampleElement, exampleRenderer);
    const renderer = RendererRegistry.getRenderer(new ExampleElement());

    expect(RendererRegistry.isRendererAsync(renderer)).toBe(false);
  });
});

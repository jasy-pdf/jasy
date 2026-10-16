import { describe, it, expect } from "vitest";
import {
  RendererRegistry,
  MissingRendererError,
  ElementReusedError,
} from "../../../src/lib/utils/renderer-registry.ts";
import {
  Document,
  Page,
  Column,
  Row,
  Text,
  Divider,
  Spacer,
  renderToBytes,
} from "../../../src/lib/index.ts";

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

// An element holds ONE position. Drawn twice on a page, both copies landed where it was laid out last
// and one went missing without a word - so it is refused, by name.
describe("one element instance per page", () => {
  it("throws when the same element is drawn twice on one page", async () => {
    const divider = Divider();
    const doc = Document([Page([Column([Text("one"), divider, Text("two"), divider])])]);
    await expect(renderToBytes(doc)).rejects.toThrow(ElementReusedError);
  });

  it("names the element and says how to fix it", async () => {
    const shared = Text("shared");
    const doc = Document([Page([Column([shared, Row([Text("x"), shared])])])]);
    await expect(renderToBytes(doc)).rejects.toThrow(/same TextElement element is used twice/);
  });

  it("an element that draws nothing may be reused: a Spacer has no place to land wrongly", async () => {
    const gap = Spacer(20);
    const flexGap = Spacer();
    const doc = Document([
      Page([
        Column([Text("a"), gap, Text("b"), gap, Row([Text("c"), flexGap, Text("d"), flexGap])]),
      ]),
    ]);
    await expect(renderToBytes(doc)).resolves.toBeInstanceOf(Uint8Array);
  });

  it("the same element on different pages is fine (a page lays it out on its own)", async () => {
    const shared = Text("shared");
    await expect(renderToBytes(Document([Page([shared]), Page([shared])]))).resolves.toBeInstanceOf(
      Uint8Array,
    );
  });

  it("a header repeated on every page of a long body is fine", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => Text(`line ${i}`));
    const doc = Document([Page({ header: Text("Header") }, [Column(lines)])]);
    await expect(renderToBytes(doc)).resolves.toBeInstanceOf(Uint8Array);
  });
});

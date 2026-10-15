import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Row,
  Column,
  Expanded,
  Text,
  Box,
  renderToBytes,
} from "../../../../src/lib/index.ts";
import { TextElement } from "../../../../src/lib/elements/text-element.ts";

// An Expanded fills its MAIN axis. Across it, it is an ordinary child: with no width bound it takes
// its content's natural width. It used to keep the width of its previous layout call instead - 0 on
// the first - so the same document laid out differently depending on what ran before.

const textNode = (root: unknown, content: string): TextElement => {
  const seen = new Set<unknown>();
  const walk = (node: unknown): TextElement | undefined => {
    if (!node || typeof node !== "object" || seen.has(node)) return undefined;
    seen.add(node);
    if (node instanceof TextElement && node.getProps().content === content) return node;
    for (const value of Object.values(node as Record<string, unknown>)) {
      for (const kid of Array.isArray(value) ? value : [value]) {
        const hit = walk(kid);
        if (hit) return hit;
      }
    }
    return undefined;
  };
  const hit = walk(root);
  if (!hit) throw new Error(`no text "${content}"`);
  return hit;
};

describe("an Expanded with no width bound", () => {
  // A Column inside a Row is measured with an unbounded width, so its Expanded sees none either.
  const layout = async () => {
    const doc = Document([
      Page({ size: "A6", margin: 20 }, [
        Row({}, [
          Column({}, [Expanded(Text("hello wide world")), Text("after")]),
          Box({ width: 30 }, [Text("R")]),
        ]),
      ]),
    ]);
    await renderToBytes(doc);
    return {
      hello: textNode(doc, "hello wide world").getProps(),
      after: textNode(doc, "after").getProps(),
      next: textNode(doc, "R").getProps(),
    };
  };

  it("keeps its content on one line, at the content's natural width", async () => {
    const { hello, after } = await layout();
    expect(hello.height).toBe(after.height); // one line, not one word per line
  });

  it("does not run into its neighbour", async () => {
    // The natural one-line width, measured where nothing bounds it: a Text alone in a Row.
    const alone = Document([
      Page({ size: "A6", margin: 20 }, [Row({}, [Text("hello wide world")])]),
    ]);
    await renderToBytes(alone);
    const natural = textNode(alone, "hello wide world").getProps().width!;
    const { hello, next } = await layout();
    expect(next.x).toBeGreaterThanOrEqual(hello.x + natural);
  });
});

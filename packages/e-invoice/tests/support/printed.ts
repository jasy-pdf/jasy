import { renderToBytes } from "@jasy/pdf";
import type { PDFDocumentElement } from "@jasy/pdf";
import { bundledFonts } from "../../src/fonts.ts";

/**
 * Every string the template puts into the layout, in tree order.
 *
 * This reads the ELEMENT TREE, not the finished PDF: the drawn text uses a subsetted Identity-H
 * font, so the content stream holds glyph ids, not readable characters. What is really drawn where
 * is the job of `template-overflow.test.ts`; this answers the other half - does the value reach the
 * page at all.
 *
 * The tree is read AFTER a layout pass, with the fonts the invoice ships: a content-sized table
 * column ("auto", "minmax()") builds its cells only then, and a Text's `spans` are what is drawn -
 * a character no font can draw is already gone from them.
 */
export async function printedText(root: PDFDocumentElement): Promise<string[]> {
  await renderToBytes(root, { fonts: bundledFonts(), standardFonts: false });
  const out: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    const props = (node as { getProps?: () => { spans?: unknown } }).getProps?.();
    if (Array.isArray(props?.spans)) {
      out.push(props.spans.map((span: { content: string }) => span.content).join(""));
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else walk(value);
    }
  };

  walk(root);
  return out;
}

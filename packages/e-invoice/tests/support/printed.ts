import type { PDFElement } from "@jasy/pdf";

/**
 * Every string the template puts into the layout, in tree order.
 *
 * This reads the ELEMENT TREE, not the finished PDF: the drawn text uses a subsetted Identity-H
 * font, so the content stream holds glyph ids, not readable characters. What is really drawn where
 * is the job of `template-overflow.test.ts`; this answers the other half - does the value reach the
 * page at all.
 */
export function printedText(root: PDFElement): string[] {
  const out: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    const props = (node as { getProps?: () => { content?: unknown } }).getProps?.();
    const content = props?.content;
    if (typeof content === "string") out.push(content);
    // A Text built from segments carries them instead of a plain string.
    else if (Array.isArray(content)) {
      for (const seg of content) {
        if (
          seg &&
          typeof seg === "object" &&
          typeof (seg as { text?: unknown }).text === "string"
        ) {
          out.push((seg as { text: string }).text);
        }
      }
    }

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else walk(value);
    }
  };

  walk(root);
  return out;
}

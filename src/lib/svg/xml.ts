import { SvgParseError } from "./errors.ts";

/**
 * A minimal XML reader for SVG.
 *
 * We used `svg-parser` first. It COERCES an attribute that looks numeric, so `id="58310095e0"` came
 * back as the number 58310095 and `id="1e999"` as Infinity - the original string simply gone. That
 * breaks the one thing it is needed for, resolving `url(#id)` references, and no amount of care on
 * our side can undo it. An XML attribute is a string; this reader treats it as one.
 *
 * The scope is what SVG actually needs: elements, attributes, text, CDATA, comments, the XML
 * declaration and a doctype. No entity expansion beyond the five predefined ones plus numeric
 * references, no DTD processing, no namespace resolution (the caller strips prefixes itself).
 */

export interface XmlElement {
  type: "element";
  tagName: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}

export interface XmlText {
  type: "text";
  value: string;
}

export type XmlNode = XmlElement | XmlText;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** The five predefined entities plus numeric references; anything else is left as written. */
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x")
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

const ATTRIBUTE = /([^\s=/>]+)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTRIBUTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(text)) !== null) {
    // A valueless attribute (`hidden`) is its own name, as in HTML; SVG has none, but it must not
    // swallow the following one.
    out[match[1]!] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return out;
}

/**
 * Parses a document into its root elements. Text outside an element is dropped, which is what the
 * whitespace between tags is.
 *
 * Mismatched closing tags are tolerated rather than fatal: real exports contain them, browsers
 * recover, and a logo that draws is worth more than a purist error. An unclosed element simply ends
 * at the end of the document.
 */
/**
 * The index of the `>` that ends a tag, skipping any inside a quoted attribute value - `d="M0 0>10"`
 * is legal XML, and a plain `indexOf(">")` would cut the tag in half there.
 */
function tagEnd(source: string, from: number): number {
  let quote = "";
  for (let i = from + 1; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

export function parseXml(source: string): XmlElement[] {
  const roots: XmlElement[] = [];
  const stack: XmlElement[] = [];
  let i = 0;

  const push = (node: XmlNode): void => {
    if (stack.length === 0) {
      if (node.type === "element") roots.push(node);
    } else {
      stack[stack.length - 1]!.children.push(node);
    }
  };

  while (i < source.length) {
    const open = source.indexOf("<", i);
    if (open === -1) break;

    if (open > i) {
      const raw = source.slice(i, open);
      if (/\S/.test(raw)) push({ type: "text", value: decodeEntities(raw) });
    }

    // `<!-- -->`, `<![CDATA[ ]]>`, `<?xml ?>` and `<!DOCTYPE >` are skipped or unwrapped whole.
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      const value = source.slice(open + 9, end === -1 ? source.length : end);
      if (value) push({ type: "text", value });
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith("<!", open)) {
      // A doctype may carry an internal subset in brackets, which can itself contain '>'.
      let depth = 0;
      let j = open + 2;
      for (; j < source.length; j++) {
        const ch = source[j];
        if (ch === "[") depth++;
        else if (ch === "]") depth--;
        else if (ch === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }

    const close = tagEnd(source, open);
    if (close === -1) break;
    const inner = source.slice(open + 1, close);

    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      // Close the nearest matching ancestor. A stray closing tag with no match is ignored.
      const at = stack.map((e) => e.tagName).lastIndexOf(name);
      if (at !== -1) stack.length = at;
      i = close + 1;
      continue;
    }

    const selfClosing = inner.trimEnd().endsWith("/");
    const body = selfClosing ? inner.slice(0, inner.lastIndexOf("/")) : inner;
    const nameEnd = body.search(/[\s/]/);
    const tagName = (nameEnd === -1 ? body : body.slice(0, nameEnd)).trim();
    if (tagName === "") {
      i = close + 1;
      continue;
    }
    const element: XmlElement = {
      type: "element",
      tagName,
      attributes: nameEnd === -1 ? {} : parseAttributes(body.slice(nameEnd)),
      children: [],
    };
    push(element);
    if (!selfClosing) stack.push(element);
    i = close + 1;
  }

  if (roots.length === 0) throw new SvgParseError("the file contains no XML elements at all.");
  return roots;
}

import { SvgUnsupportedError } from "./errors.ts";

/**
 * The `<style>` block - the third way an SVG carries style, beside presentation attributes and the
 * `style=""` bag.
 *
 * It exists here because it is the case that BREAKS in practice: Illustrator's default export option
 * is "Internal CSS", which puts every fill into a class and leaves the shapes with nothing but
 * `class="st0"`. Dropping the block therefore does not lose a detail - it makes the whole logo black.
 * (react-pdf drops it, with a warning; we dropped it silently until this module existed.)
 *
 * Only FLAT selectors are resolved - a tag, `.class`, `#id`, and compounds of those - because that is
 * what exporters emit. A combinator or a pseudo-class is reported rather than quietly mismatched: a
 * selector that silently fails to match is the same black logo again, one level down.
 */

export interface CssRule {
  tag?: string;
  id?: string;
  classes: string[];
  /** CSS specificity as one number, and the source order that breaks ties. */
  weight: number;
  order: number;
  declarations: Record<string, string>;
}

const COMMENTS = /\/\*[\s\S]*?\*\//g;

/** One compound selector, e.g. `rect.st0#a`. Anything structural is refused, not approximated. */
function parseSelector(selector: string, order: number): Omit<CssRule, "declarations"> {
  const text = selector.trim();
  if (/[\s>+~]/.test(text)) {
    throw new SvgUnsupportedError(
      `the CSS selector "${text}" (it combines elements)`,
      "Only flat selectors are resolved. Re-export with presentation attributes instead.",
    );
  }
  if (text.includes(":") || text.includes("[")) {
    throw new SvgUnsupportedError(
      `the CSS selector "${text}" (pseudo-class or attribute selector)`,
      "Only a tag, .class and #id are resolved. Re-export with presentation attributes instead.",
    );
  }
  const classes = [...text.matchAll(/\.([\w-]+)/g)].map((m) => m[1]!);
  const id = /#([\w-]+)/.exec(text)?.[1];
  const tag = /^[\w-]+/.exec(text)?.[0];
  // The usual a-b-c weights, flattened: an id beats any number of classes, a class beats a tag.
  const weight = (id ? 10000 : 0) + classes.length * 100 + (tag ? 1 : 0);
  return { tag, id, classes, weight, order };
}

function parseDeclarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const declaration of body.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim();
    // `!important` would need a second cascade level; exporters do not emit it, so it is refused
    // rather than silently treated as a normal declaration.
    const value = declaration.slice(colon + 1).trim();
    if (!property) continue;
    if (/!\s*important$/i.test(value)) {
      throw new SvgUnsupportedError(
        `"!important" in a <style> block`,
        "Remove it, or re-export with presentation attributes.",
      );
    }
    out[property] = value;
  }
  return out;
}

/**
 * Parses every `<style>` block's text into rules, in source order.
 *
 * The brace matching is done by hand rather than with one regex: `@media print { .a { … } }` nests,
 * and a regex that skips to the first balanced-looking block silently applies the INNER rule while
 * never seeing the at-rule that guards it.
 */
export function parseStylesheet(css: string): CssRule[] {
  const text = css.replace(COMMENTS, "");
  const rules: CssRule[] = [];
  let order = 0;
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open === -1) break;
    const prelude = text.slice(i, open).trim();

    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }

    if (prelude.startsWith("@")) {
      // An at-rule is DROPPED, not reported - which is what CSS itself does with one it cannot
      // evaluate, and what the corpus demanded: 68 of 10,819 real files carry a `@media
      // (prefers-color-scheme)` or a `@keyframes` that can never apply to a static page, and
      // refusing them meant those files did not render at all.
      // The exception is a query that always holds for print, whose rules DO apply.
      const [at, ...query] = prelude.split(/\s+/);
      const applies = at === "@media" && ["print", "all", ""].includes(query.join(" ").trim());
      if (applies) {
        // Its body is a nested stylesheet; parse it in place so the rules keep their source order.
        for (const rule of parseStylesheet(text.slice(open + 1, j - 1))) {
          rules.push({ ...rule, order: order++ });
        }
      }
      i = j;
      continue;
    }

    const declarations = parseDeclarations(text.slice(open + 1, j - 1));
    for (const selector of prelude.split(",")) {
      if (selector.trim() === "") continue;
      rules.push({ ...parseSelector(selector, order++), declarations });
    }
    i = j;
  }
  return rules;
}

/**
 * The declarations that apply to one element, weakest first - so a caller can just assign them in
 * order and let the last one win, as the cascade does.
 */
export function declarationsFor(
  rules: readonly CssRule[],
  tagName: string,
  attributes: { class?: string; id?: string },
): Record<string, string> {
  if (rules.length === 0) return {};
  const classes = (attributes.class ?? "").trim().split(/\s+/).filter(Boolean);
  const matched = rules.filter(
    (rule) =>
      (rule.tag === undefined || rule.tag === tagName) &&
      (rule.id === undefined || rule.id === attributes.id) &&
      rule.classes.every((name) => classes.includes(name)),
  );
  matched.sort((a, b) => a.weight - b.weight || a.order - b.order);
  const out: Record<string, string> = {};
  for (const rule of matched) Object.assign(out, rule.declarations);
  return out;
}

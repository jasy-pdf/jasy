import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { Document, DefaultTextStyle, Text, Paragraph, Span } from "../src/index.ts";

// The components forward `{ ...attrs, ...props }`, so an UNDECLARED prop still reaches the engine -
// which is why this drifted through four features without anything failing. Undeclared means no type,
// no autocomplete, no template check: the user has to already know the prop exists.
//
// The guard is therefore on the DECLARATION, not on behaviour: every option the public text interfaces
// offer must be a declared prop. Read out of the engine's own source, because the types are erased at
// runtime and this test tree is not type-checked (todo.md ISSUE-6).

const source = readFileSync(
  fileURLToPath(new URL("../../../src/lib/api/text.ts", import.meta.url)),
  "utf8",
);

/**
 * The options one `export interface X { ... }` offers: its own properties plus those of the interface
 * it extends, minus anything an `extends Omit<..., "a" | "b">` takes back off (that is how
 * `TextOptions` drops the span-only `verticalAlign`). Doc comments are ignored.
 */
function optionsOf(name: string): string[] {
  const decl = new RegExp(`export interface ${name}([^{]*)\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!decl) throw new Error(`interface ${name} not found - did api/text.ts move?`);
  const base = /extends\s+(?:Omit<\s*)?(\w+)/.exec(decl[1]!)?.[1];
  const omitted = [...decl[1]!.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
  const own = [...decl[2]!.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!);
  return [...(base ? optionsOf(base) : []), ...own].filter((key) => !omitted.includes(key));
}

const declared = (component: { props?: object }) => Object.keys(component.props ?? {});

// [component, the options it must declare, props it may have BESIDE them]. The extras are named one by
// one on purpose: a prop that is in neither list is a typo (`textIndentation`) or a leftover, and both
// are invisible otherwise - the forwarding passes anything through.
const cases: [string, { props?: object }, string[], string[]][] = [
  ["Text", Text, optionsOf("TextOptions"), []],
  ["Paragraph", Paragraph, optionsOf("TextOptions"), []],
  ["Span", Span, optionsOf("TextStyle"), []],
  // `meta` and `fonts` are document-level, not text options.
  ["Document", Document, optionsOf("TextDefaults"), ["meta", "fonts"]],
  ["DefaultTextStyle", DefaultTextStyle, optionsOf("TextDefaults"), []],
];

describe("every public text option is a declared prop", () => {
  it("really reads the interfaces, inheritance and omissions included", () => {
    // Guards the parser itself: a rename that emptied it would make every case below vacuously green.
    expect(optionsOf("TextStyle")).toContain("ligatures");
    expect(optionsOf("TextDefaults")).toContain("hyphenate");
    expect(optionsOf("TextOptions")).toEqual(expect.arrayContaining(["maxLines", "letterSpacing"]));
    // Inherited from TextStyle, then omitted again: a span raises one run, a whole Text is a block.
    expect(optionsOf("TextOptions")).not.toContain("verticalAlign");
    expect(optionsOf("TextStyle")).toContain("verticalAlign");
  });

  it.each(cases)(
    "%s declares every option and nothing else",
    (_name, component, options, extra) => {
      const props = declared(component);
      expect(options.filter((option) => !props.includes(option))).toEqual([]);
      expect(props.filter((prop) => !options.includes(prop) && !extra.includes(prop))).toEqual([]);
    },
  );

  // The one place a text style is deliberately NOT uniform: `vertical-align` raises a single run, so it
  // belongs to a span. `Text` is the block, and CSS ignores it there too - hence the Omit in TextOptions.
  it("keeps verticalAlign on the span and off the block", () => {
    expect(declared(Span)).toContain("verticalAlign");
    for (const block of [Text, Paragraph, Document, DefaultTextStyle]) {
      expect(declared(block)).not.toContain("verticalAlign");
    }
  });
});

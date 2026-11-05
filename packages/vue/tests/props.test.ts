import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as vue from "../src/index.ts";

// The components forward `{ ...attrs, ...props }`, so an UNDECLARED prop still reaches the engine -
// which is how options once drifted in for months unnoticed: no type, no autocomplete, no template check.
//
// The guard is therefore on the DECLARATION: every option the engine's own interface offers must be a
// declared prop. Read out of the engine's source, because the types are erased at runtime and this test
// tree is not type-checked (todo.md ISSUE-6).

const lib = fileURLToPath(new URL("../../../src/lib/", import.meta.url));
const source = [
  ...readdirSync(`${lib}api`).map((f) => `api/${f}`),
  "elements/layout/positioned-element.ts",
]
  .map((f) => readFileSync(lib + f, "utf8"))
  .join("\n");

/**
 * The options one `interface X { ... }` offers: its own properties plus those of the interface it
 * extends, minus anything an `extends Omit<..., "a" | "b">` takes back off. Doc comments are ignored.
 */
function optionsOf(name: string): string[] {
  const decl = new RegExp(`(?:export )?interface ${name}([^{]*)\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!decl) throw new Error(`interface ${name} not found - did src/lib/api move?`);
  const base = /extends\s+(?:Omit<\s*)?(\w+)/.exec(decl[1]!)?.[1];
  const omitted = [...decl[1]!.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
  const own = [...decl[2]!.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!);
  return [...(base ? optionsOf(base) : []), ...own].filter((key) => !omitted.includes(key));
}

const declared = (component: unknown) => Object.keys((component as { props?: object }).props ?? {});

// [component, the engine interface it must cover, props it may have BESIDE them, options it deliberately
// does not offer]. Both lists are named one by one: an unlisted extra is a typo or a dead knob (a prop
// the engine ignores looks like it works and does nothing), and an unlisted gap is drift.
type Case = [name: string, options: string, extra: string[], notOffered: string[]];
const cases: Case[] = [
  // `fonts` registers fonts on the document; it is not a text option.
  ["Document", "DocumentOptions", ["fonts"], []],
  // `header`/`footer` are the #header/#footer slots. `Page()` reads only gap/justify/align of the stack
  // options its type inherits - the rest would be dead props.
  [
    "Page",
    "PageOptions",
    [],
    ["header", "footer", "alignSelf", "order", "flexShrink", "minWidth", "maxWidth", "minHeight"]
      .concat(["maxHeight", "aspectRatio", "width", "height", "breakBefore", "breakAfter"])
      .concat(["keepTogether", "reverse", "wrap", "alignContent"]),
  ],
  ["Column", "StackOptions", [], []],
  ["Row", "StackOptions", [], []],
  ["Box", "BoxOptions", [], []],
  ["Expanded", "ExpandedOptions", [], []],
  ["Divider", "DividerOptions", [], []],
  // The source is the factory's first argument; here it is a prop.
  ["Image", "ImageOptions", ["src"], []],
  ["Svg", "SvgOptions", ["src"], []],
  ["Canvas", "CanvasOptions", ["paint"], []],
  ["Text", "TextOptions", [], []],
  ["Paragraph", "TextOptions", [], []],
  ["Span", "TextStyle", [], []],
  ["DefaultTextStyle", "TextDefaults", [], []],
  ["PageNumber", "PageNumberOptions", [], []],
  ["PageCount", "PageNumberOptions", [], []],
  // The header row is a <TableRow header>, not a prop.
  ["Table", "TableOptions", [], ["header"]],
  // The template is the #page slot.
  ["Flow", "FlowOptions", [], ["template"]],
  ["Region", "RegionOptions", [], []],
  ["SplitView", "SplitViewOptions", [], []],
  ["Positioned", "PositionedInsets", [], []],
  ["TextField", "TextFieldOptions", [], []],
  ["Checkbox", "CheckboxOptions", [], []],
  // A template has no second argument, so the choices are a prop.
  ["RadioGroup", "RadioGroupOptions", ["options"], []],
  ["Dropdown", "DropdownOptions", ["options"], []],
  ["ListBox", "ListBoxOptions", ["options"], []],
  ["PushButton", "PushButtonOptions", [], []],
  ["SignatureField", "SignatureFieldOptions", [], []],
];

describe("every engine option is a declared prop, and nothing else is", () => {
  it("really reads the interfaces, inheritance and omissions included", () => {
    // Guards the parser itself: a rename that emptied it would make every case below vacuously green.
    expect(optionsOf("TextStyle")).toContain("ligatures");
    expect(optionsOf("TextDefaults")).toContain("hyphenate");
    expect(optionsOf("TextOptions")).toEqual(expect.arrayContaining(["maxLines", "letterSpacing"]));
    expect(optionsOf("TextOptions")).not.toContain("verticalAlign");
    expect(optionsOf("BoxOptions")).toEqual(expect.arrayContaining(["alignSelf", "radius"]));
    expect(optionsOf("ListBoxOptions")).toEqual(expect.arrayContaining(["values", "fontSize"]));
  });

  it.each(cases)("%s", (name, options, extra, notOffered) => {
    const props = declared(vue[name as keyof typeof vue]);
    const offered = optionsOf(options).filter((option) => !notOffered.includes(option));
    expect(offered.filter((option) => !props.includes(option))).toEqual([]);
    expect(props.filter((prop) => !offered.includes(prop) && !extra.includes(prop))).toEqual([]);
  });

  it("covers every component the package exports", () => {
    // A new component without a case here would go unchecked. Components without options of their own
    // (structural markers, wrappers whose props are plain names) are listed with their reason.
    const exempt = [
      "Padding",
      "Spacer",
      "PageBreak",
      "KeepTogether",
      "TableRow",
      "TableCell",
    ].concat(["ColumnBreak", "Link", "Anchor", "Bookmark", "Rotated", "RotatedBox", "PageBuilder"]);
    const components = Object.entries(vue)
      .filter(([, v]) => typeof v === "object" && v !== null && "setup" in v)
      .map(([k]) => k);
    const covered = cases.map((c) => c[0]);
    expect(components.filter((c) => !covered.includes(c) && !exempt.includes(c))).toEqual([]);
  });

  // `vertical-align` raises a single run, so it belongs to a span. `Text` is the block, and CSS ignores
  // it there too - hence the Omit in TextOptions.
  it("keeps verticalAlign on the span and off the block", () => {
    expect(declared(vue.Span)).toContain("verticalAlign");
    for (const block of [vue.Text, vue.Paragraph, vue.Document, vue.DefaultTextStyle]) {
      expect(declared(block)).not.toContain("verticalAlign");
    }
  });
});

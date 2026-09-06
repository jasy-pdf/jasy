# Benchmarks

Numbers anyone can reproduce. No claim on the site should exist that you cannot re-derive here.

```bash
cd bench
pnpm install        # pins the versions it compares against
pnpm bench          # every case
pnpm bench text     # one case
```

The runner prints the machine (CPU, Node, OS) with the results, because a time without a machine under
it cannot be checked.

## What makes it fair, and how it is enforced

**Both engines must lay out the same document.** This is the trap that made an earlier measurement of
ours worthless: the same source produced 37 pages on one side and 33 on the other, and the published
number compared two different documents. So every result carries its **page count**, and the runner
refuses to print a comparison whose page counts differ - it says so instead.

Two things that had to be pinned by hand, both discovered by the page count disagreeing:

- **Spacing has to be declared the same way.** A page-level `gap` in jasy spaces _every_ child, table
  rows included; react-pdf has no such thing and gets its spacing per element. Declaring them
  differently silently changes how much fits on a page.
- **`margin` vs `padding`, and the default line box.** react-pdf spells the page inset `padding`, we
  spell it `margin`. Our default line height is the font's natural one (Helvetica 1.156 em),
  react-pdf's is `ascent - descent` (1.10 em). Both are pinned in the cases.

**Same features on.** Both engines kern by default and both embed and subset the TrueType face in the
`typography` case - verified by reading the operators back out of the produced PDFs, not assumed.

## What is compared

`@react-pdf/renderer`, pinned. It is the honest comparison: the same idea, declarative components to
PDF, no browser. `pdf-lib` and `PDFKit` are deliberately absent - they have no layout engine, so a
layout benchmark against them would be a win we did not earn.

## The cases

| case         | what it exercises                                       |
| ------------ | ------------------------------------------------------- |
| `text`       | line breaking and pagination, standard-14 face          |
| `typography` | an embedded TrueType: real kerning and ligatures        |
| `boxes`      | geometry - borders, radii, fills, almost no text        |
| `svg`        | vector marks: paths, strokes, joins                     |
| `canvas`     | the imperative pen                                      |
| `document`   | the mixed case: repeating header/footer, prose, a table |

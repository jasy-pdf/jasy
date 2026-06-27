# Contributing to jasy

Thanks for your interest in contributing! ❤️ jasy is a pure-TypeScript toolkit for generating PDFs and
ZUGFeRD / XRechnung e-invoices. This guide covers local setup, the workspace layout, and the checks CI
runs.

## Requirements

- Node 22+ (24 recommended)
- pnpm 9+ (the repo is a pnpm workspace; do not use npm/yarn)

## Local setup

```bash
pnpm install
pnpm run build        # tsc -> dist/ for every package
pnpm exec vitest run  # run the full test suite once (CI-style)
```

## Workspace layout

jasy is a pnpm monorepo. `@jasy/pdf` is the **root** package (the engine, in `src/lib/`); the others live
in `packages/`:

| Package         | What it is                                              |
| --------------- | ------------------------------------------------------- |
| `@jasy/pdf`     | the declarative, Flutter-style PDF engine (repo root)   |
| `@jasy/vue`     | author PDFs as Vue components, rendered in the browser  |
| `@jasy/nuxt`    | the Nuxt module (client or server, zero-config)         |
| `@jasy/zugferd` | ZUGFeRD / XRechnung: conformant PDF/A-3 + EN-16931 XML  |
| `@jasy/cli`     | the `jasy` terminal: read, validate and export invoices |

`CLAUDE.md` in the repo root is the architecture map - read it before larger changes.

## Common commands

```bash
pnpm run build                 # build all packages
pnpm test                      # vitest (watch)
pnpm exec vitest run           # one-shot run (what CI does)
pnpm run test:coverage         # coverage

pnpm --filter @jasy/vue test   # test a single package
pnpm --filter @jasy/nuxt dev   # run a package's dev/playground
```

Unit tests live in `tests/unit/`, mirroring `src/lib/`. Add a test for any new element, renderer or
helper.

## Conventions

- Comments and identifiers in **English**.
- Element constructors take a **single options object** (Flutter-style), with sensible defaults.
- Renderers return `IRNode[]` - PDF operators live only in `PdfBackend`. Never reach into an element's
  privates; consume `getProps()`.
- Keep changes focused, and don't break the hand-rolled font math.

## Contribution workflow

- For anything larger than a small fix, **open an issue or a discussion first** so we can align.
- Fork the repo, branch, and open a pull request - direct pushes and tags are restricted to the
  maintainer.
- Make sure `pnpm exec vitest run` is green and the build passes before requesting review.

## License

By contributing, you agree that your contributions are licensed under the project's [MIT License](./LICENSE).

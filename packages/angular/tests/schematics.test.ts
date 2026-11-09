// ng add and ng generate, run on a workspace that @schematics/angular creates the way `ng new` does.
import type { Rule, Tree } from "@angular-devkit/schematics";
import { SchematicTestRunner } from "@angular-devkit/schematics/testing";
import { lastValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { ngAdd } from "../schematics/ng-add/index.ts";
import { pdf } from "../schematics/pdf/index.ts";

const runner = new SchematicTestRunner(
  "@jasy/angular",
  new URL("../schematics/collection.json", import.meta.url).pathname,
);

async function newApp(): Promise<Tree> {
  const tree = await runner.runExternalSchematic("@schematics/angular", "workspace", {
    name: "workspace",
    newProjectRoot: "projects",
    version: "20.3.0",
  });
  return runner.runExternalSchematic(
    "@schematics/angular",
    "application",
    { name: "shop", standalone: true },
    tree,
  );
}
const run = (rule: Rule, tree: Tree) => lastValueFrom(runner.callRule(rule, tree));
const buildOptions = (tree: Tree) =>
  JSON.parse(tree.readText("/angular.json")).projects.shop.architect.build.options;

describe("ng add @jasy/angular", () => {
  it("adds @jasy/pdf, provideJasy() and the CommonJS allowance", async () => {
    const tree = await run(ngAdd({}), await newApp());

    expect(JSON.parse(tree.readText("/package.json")).dependencies["@jasy/pdf"]).toBeDefined();
    expect(buildOptions(tree).allowedCommonJsDependencies).toEqual([
      "svgpath",
      "brotli",
      "base64-js",
    ]);
    const config = tree.readText("/projects/shop/src/app/app.config.ts");
    expect(config).toContain(`import { provideJasy } from '@jasy/angular';`);
    expect(config).toContain("provideJasy()");
  });

  it("changes nothing the second time, and keeps what the app already allowed", async () => {
    const app = await newApp();
    const angularJson = JSON.parse(app.readText("/angular.json"));
    angularJson.projects.shop.architect.build.options.allowedCommonJsDependencies = [
      "lodash",
      "brotli",
    ];
    app.overwrite("/angular.json", JSON.stringify(angularJson));

    const tree = await run(ngAdd({}), await run(ngAdd({}), app));
    expect(buildOptions(tree).allowedCommonJsDependencies).toEqual([
      "lodash",
      "brotli",
      "svgpath",
      "base64-js",
    ]);
    const config = tree.readText("/projects/shop/src/app/app.config.ts");
    expect(config.match(/provideJasy\(\)/g)).toHaveLength(1);
  });

  it("in an SSR app, also allows what jimp brings into the server bundle", async () => {
    const workspace = await runner.runExternalSchematic("@schematics/angular", "workspace", {
      name: "workspace",
      newProjectRoot: "projects",
      version: "20.3.0",
    });
    const app = await runner.runExternalSchematic(
      "@schematics/angular",
      "application",
      { name: "shop", standalone: true, ssr: true },
      workspace,
    );
    const tree = await run(ngAdd({}), app);
    const allowed: string[] = buildOptions(tree).allowedCommonJsDependencies;
    expect(allowed).toContain("svgpath");
    expect(allowed).toEqual(expect.arrayContaining(["pngjs", "jpeg-js", "omggif", "mime"]));
  });

  it("names a project that does not exist", async () => {
    await expect(run(ngAdd({ project: "nope" }), await newApp())).rejects.toThrow(
      'There is no project "nope" in this workspace.',
    );
  });
});

describe("ng generate @jasy/angular:pdf", () => {
  it("creates <name>.pdf.ts with a typed document", async () => {
    const tree = await run(pdf({ name: "invoice", project: "shop" }), await newApp());
    const file = tree.readText("/projects/shop/src/app/invoice.pdf.ts");
    expect(file).toContain("export interface InvoiceData {");
    expect(file).toContain("export const invoicePdf: PdfDocumentFn<InvoiceData> = (data) =>");
  });

  it("takes a path in the name, and the .pdf ending is optional", async () => {
    const tree = await run(
      pdf({ name: "reports/monthly-summary.pdf", project: "shop" }),
      await newApp(),
    );
    const file = tree.readText("/projects/shop/src/app/reports/monthly-summary.pdf.ts");
    expect(file).toContain("export const monthlySummaryPdf: PdfDocumentFn<MonthlySummaryData>");
  });

  it("refuses to overwrite a file that exists", async () => {
    const tree = await run(pdf({ name: "invoice", project: "shop" }), await newApp());
    await expect(run(pdf({ name: "invoice", project: "shop" }), tree)).rejects.toThrow(
      /invoice.pdf.ts" already exist/,
    );
  });
});

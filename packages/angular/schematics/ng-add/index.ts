import { SchematicsException, chain, noop, type Rule, type Tree } from "@angular-devkit/schematics";
import {
  ExistingBehavior,
  addDependency,
  addRootProvider,
  readWorkspace,
  updateWorkspace,
} from "@schematics/angular/utility";

/** What @jasy/pdf brings as CommonJS; `ng build` warns about each one unless it is allowed. */
const COMMONJS = ["svgpath", "brotli", "base64-js"];

/** The @jasy/pdf range this package was released against: its peer dependency. */
const pdfRange = (): string => {
  const range: string = require("../../package.json").peerDependencies["@jasy/pdf"];
  return range.startsWith("workspace:") ? "latest" : range;
};

/** `ng add @jasy/angular`: everything the README's setup does, in one step. Safe to run twice. */
export function ngAdd(options: { project?: string }): Rule {
  return async (tree) => {
    const workspace = await readWorkspace(tree);
    const name =
      options.project ??
      [...workspace.projects.keys()].find(
        (n) => workspace.projects.get(n)?.extensions["projectType"] === "application",
      );
    const project = name ? workspace.projects.get(name) : undefined;
    if (!name || !project) {
      throw new SchematicsException(
        options.project
          ? `There is no project "${options.project}" in this workspace.`
          : "This workspace has no application to add @jasy/angular to. Pass --project.",
      );
    }

    return chain([
      // Documents import Document, Page, Text from @jasy/pdf, so the app depends on it directly.
      addDependency("@jasy/pdf", pdfRange(), { existing: ExistingBehavior.Skip }),
      updateWorkspace((ws) => {
        const build = ws.projects.get(name)?.targets.get("build");
        if (!build) return;
        const options = (build.options ??= {});
        const allowed = (options["allowedCommonJsDependencies"] as string[] | undefined) ?? [];
        options["allowedCommonJsDependencies"] = [
          ...allowed,
          ...COMMONJS.filter((d) => !allowed.includes(d)),
        ];
      }),
      providesJasy(tree, project.sourceRoot ?? `${project.root}/src`)
        ? noop()
        : addRootProvider(
            name,
            ({ code, external }) => code`${external("provideJasy", "@jasy/angular")}()`,
          ),
    ]);
  };
}

/** Whether the app already calls provideJasy() somewhere, so a second run adds nothing. */
function providesJasy(tree: Tree, root: string): boolean {
  let found = false;
  tree.getDir(root).visit((path) => {
    if (!found && path.endsWith(".ts")) found = tree.readText(path).includes("provideJasy(");
  });
  return found;
}

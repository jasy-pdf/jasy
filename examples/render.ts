// Renders every template in examples/templates/ (or one named on the CLI) to a PDF in examples/out/.
// Most templates `export default` a jasy Document (rendered via @jasy/pdf). A ZUGFeRD template instead
// `export const zugferd = { invoice, options }` and is rendered via @jasy/zugferd to a PDF/A-3 + XML.
import { renderToBytes } from "@jasy/pdf";
import { renderZugferd } from "@jasy/zugferd";
import { writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const only = process.argv[2];
const dir = "examples/templates";
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.replace(/\.ts$/, ""))
  .filter((n) => !only || n === only);

mkdirSync("examples/out", { recursive: true });
for (const name of names) {
  const mod = await import(resolve(dir, `${name}.ts`));
  if (mod.zugferd) {
    const { invoice, options } = mod.zugferd;
    const { bytes, xml } = await renderZugferd(invoice, options);
    writeFileSync(`examples/out/${name}.pdf`, bytes);
    writeFileSync(`examples/out/${name}.xml`, xml);
    console.log(
      `rendered examples/out/${name}.pdf + .xml (ZUGFeRD ${options?.profile ?? "en16931"})`,
    );
  } else {
    writeFileSync(`examples/out/${name}.pdf`, await renderToBytes(mod.default));
    console.log(`rendered examples/out/${name}.pdf`);
  }
}

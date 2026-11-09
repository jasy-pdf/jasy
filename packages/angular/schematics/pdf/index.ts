import { strings, type Rule } from "@angular-devkit/schematics";
import { createDefaultPath } from "@schematics/angular/utility/workspace";
import { parseName } from "@schematics/angular/utility/parse-name";

interface Options {
  name: string;
  path?: string;
  project?: string;
}

/** `ng generate @jasy/angular:pdf invoice`: an `invoice.pdf.ts` holding an `invoicePdf` document. */
export function pdf(options: Options): Rule {
  return async (tree) => {
    const where = options.path || (await createDefaultPath(tree, options.project ?? ""));
    // "invoice.pdf" and "invoice" name the same file.
    const { name, path } = parseName(where, options.name.replace(/\.pdf$/, ""));
    const file = `${path}/${strings.dasherize(name)}.pdf.ts`;
    const fn = `${strings.camelize(name)}Pdf`;
    const data = `${strings.classify(name)}Data`;

    tree.create(
      file,
      `import type { PdfDocumentFn } from "@jasy/angular";
import { Document, Page, Text } from "@jasy/pdf";

export interface ${data} {
  title: string;
}

// A PDF, written as a function of its data. It runs in an injection context, so inject() works here.
// Save it with inject(JasyPdf).download(${fn}, data), or preview it with pdfResource(${fn}, () => data).
export const ${fn}: PdfDocumentFn<${data}> = (data) =>
  Document([
    Page({ size: "A4", gap: 12 }, [
      Text(data.title, { size: 24, bold: true }),
    ]),
  ]);
`,
    );
  };
}

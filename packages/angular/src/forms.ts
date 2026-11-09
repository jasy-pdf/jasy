import {
  InjectionToken,
  Injector,
  assertInInjectionContext,
  inject,
  runInInjectionContext,
  type ResourceRef,
} from "@angular/core";
import type {
  FieldValue,
  FillOptions,
  FillResult,
  FlattenOptions,
  FlattenResult,
  OpenOptions,
  ReadForm,
} from "@jasy/pdf/edit";
import { bytesLoader, type FileSource } from "./load.js";

/** Field name to value. `undefined` leaves a field as it is - an Angular form's value omits a disabled control. */
export type FormValues = Record<string, FieldValue | undefined>;
const defined = (values: FormValues) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined)) as Record<
    string,
    FieldValue
  >;
import { previewResource, type PdfFile } from "./resource.js";

/**
 * Reads, fills and flattens the form of an existing PDF - in the browser and on the server.
 * `inject(JasyForms)` in an injection context. The PDF reader is loaded on first use, so an app that
 * only creates PDFs never downloads it.
 */
export interface JasyForms {
  /** The form's fields: names, types, current values, choices. `undefined` for a PDF without a form. */
  read(source: FileSource, options?: OpenOptions): Promise<ReadForm | undefined>;
  /** Fills the fields by name. `{ flatten: true }` turns them into page content in the same step. */
  fill(source: FileSource, values: FormValues, options?: FillOptions): Promise<FillResult>;
  /** Turns the fields into page content, so the values can no longer be edited. */
  flatten(source: FileSource, options?: FlattenOptions): Promise<FlattenResult>;
}

export const JasyForms = new InjectionToken<JasyForms>("JasyForms", {
  providedIn: "root",
  factory: createJasyForms,
});

function createJasyForms(): JasyForms {
  const load = bytesLoader();
  // Loaded once, on first use; a failed load (a chunk lost to a deploy) is tried again next time.
  let edit: Promise<typeof import("@jasy/pdf/edit")> | undefined;
  const lib = () =>
    (edit ??= import("@jasy/pdf/edit").catch((e) => {
      edit = undefined;
      throw e;
    }));

  return {
    async read(source, options) {
      const [{ PdfDocument, readAcroForm }, bytes] = await Promise.all([lib(), load(source)]);
      return readAcroForm(await PdfDocument.open(bytes, options));
    },
    async fill(source, values, options) {
      const [{ fillForm }, bytes] = await Promise.all([lib(), load(source)]);
      return fillForm(bytes, defined(values), options);
    },
    async flatten(source, options) {
      const [{ flattenForm }, bytes] = await Promise.all([lib(), load(source)]);
      return flattenForm(bytes, options);
    },
  };
}

export interface FilledPdfResourceOptions {
  /** Fill options; a function is tracked like `values`, so a signal in it fills the form again. */
  options?: FillOptions | (() => FillOptions);
  /** Where to run, when called outside an injection context. */
  injector?: Injector;
}

/**
 * An existing PDF form, filled from your signals: the PDF is filled again whenever `values` changes,
 * and the source is read once per source, not once per change. Return `undefined` from `values` (or
 * from `source`) to wait. Like `pdfResource`, it renders only in the browser.
 *
 * ```ts
 * values = toSignal(this.form.valueChanges, { initialValue: this.form.value });
 * preview = filledPdfResource("/forms/application.pdf", this.values);
 * // @if (preview.hasValue()) { <iframe [src]="preview.value().safeUrl"></iframe> }
 * ```
 */
export function filledPdfResource(
  source: FileSource | (() => FileSource | undefined),
  values: () => FormValues | undefined,
  { options, injector }: FilledPdfResourceOptions = {},
): ResourceRef<PdfFile | undefined> {
  if (!injector) assertInInjectionContext(filledPdfResource);
  injector ??= inject(Injector);
  const forms = injector.get(JasyForms);
  const load = runInInjectionContext(injector, bytesLoader);

  let last: { source: FileSource; bytes: Promise<Uint8Array> } | undefined;
  const bytesOf = (s: FileSource) => {
    if (last?.source !== s) {
      const entry = { source: s, bytes: load(s) };
      entry.bytes.catch(() => last === entry && (last = undefined));
      last = entry;
    }
    return last.bytes;
  };

  return previewResource(
    injector,
    () => {
      const from = typeof source === "function" ? source() : source;
      const fields = values();
      if (from === undefined || fields === undefined) return undefined;
      return { from, fields, options: typeof options === "function" ? options() : options };
    },
    async ({ from, fields, options }) =>
      (await forms.fill(await bytesOf(from), fields, options)).bytes,
  );
}

import { httpResource } from "@angular/common/http";
import { Component, DestroyRef, computed, inject, linkedSignal, signal } from "@angular/core";
import { JasyPdf, pdfResource, type PdfDocumentFn } from "@jasy/angular";
import type { Diagnostic, RenderOptions } from "@jasy/pdf";
import { GROUPS, SAMPLES, type Sample, type Values } from "./samples";

const byHash = () => SAMPLES.find((s) => s.id === location.hash.slice(1)) ?? SAMPLES[0];
const initialValues = (s: Sample): Values =>
  Object.fromEntries((s.controls ?? []).map((c) => [c.key, c.initial]));

// Page objects are written uncompressed, so counting them is a cheap, honest page count.
const countPages = (bytes: Uint8Array) =>
  (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

@Component({
  selector: "app-root",
  templateUrl: "./app.html",
})
export class App {
  private readonly pdf = inject(JasyPdf);

  readonly groups = GROUPS.map((name) => ({
    name,
    samples: SAMPLES.filter((s) => s.group === name),
  }));
  readonly sample = signal(byHash());
  readonly values = linkedSignal(() => initialValues(this.sample()));
  readonly tagged = signal(false);
  readonly showCode = signal(true);

  readonly source = httpResource.text(() => `samples/${this.sample().file}`);

  // The one document the preview shows: whichever sample is selected, with the controls as its data.
  private started = 0;
  private readonly selected: PdfDocumentFn<{ sample: Sample; values: Values }> = ({
    sample,
    values,
  }) => {
    this.started = performance.now();
    return sample.document(values);
  };

  private reported: Diagnostic[] = [];
  readonly preview = pdfResource(this.selected, () => this.input(), {
    options: () => {
      // A handler collects what the engine reports; without one, it warns in the console.
      const reported: Diagnostic[] = (this.reported = []);
      return { ...this.renderOptions(), onDiagnostic: (d) => reported.push(d) };
    },
  });

  readonly stats = computed(() => {
    const file = this.preview.value();
    if (!file) return undefined;
    const pages = countPages(file.bytes);
    return {
      ms: performance.now() - this.started,
      label: `${pages} ${pages === 1 ? "page" : "pages"} · ${(file.bytes.length / 1024).toFixed(1)} KB`,
      diagnostics: this.reported,
    };
  });

  constructor() {
    // The hash is the selection, so back/forward and an edited URL switch the sample too.
    const follow = () => this.sample.set(byHash());
    addEventListener("hashchange", follow);
    inject(DestroyRef).onDestroy(() => removeEventListener("hashchange", follow));
  }

  select(sample: Sample) {
    location.hash = sample.id;
  }

  set(key: string, value: string | number) {
    this.values.update((v) => ({ ...v, [key]: value }));
  }

  // The service, used directly: the same document, saved or opened in a tab.
  download() {
    const name = `${this.sample().id}.pdf`;
    return this.pdf.download(this.selected, this.input(), name, this.renderOptions());
  }
  open() {
    return this.pdf.open(this.selected, this.input(), this.renderOptions());
  }

  error(e: unknown) {
    return String((e as Error)?.stack ?? e);
  }

  private input() {
    return { sample: this.sample(), values: this.values() };
  }
  private renderOptions(): RenderOptions {
    return { ...this.sample().options?.(this.values()), accessible: this.tagged() };
  }
}

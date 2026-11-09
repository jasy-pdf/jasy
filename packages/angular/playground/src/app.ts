import { httpResource } from "@angular/common/http";
import { Component, DestroyRef, computed, inject, linkedSignal, signal } from "@angular/core";
import { JasyPdf, pdfResource, type PdfDocument } from "@jasy/angular";
import type { Diagnostic } from "@jasy/pdf";
import { GROUPS, SAMPLES, type Sample, type Values } from "./samples";

const byHash = () => SAMPLES.find((s) => s.id === location.hash.slice(1)) ?? SAMPLES[0];
const initialValues = (s: Sample): Values =>
  Object.fromEntries((s.controls ?? []).map((c) => [c.key, c.initial]));

// Page objects are written uncompressed, so counting them is a cheap, honest page count.
const countPages = (bytes: Uint8Array) =>
  (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

// The one document the preview shows: whichever sample is selected, with the controls as its data.
const selected: PdfDocument<{ sample: Sample; values: Values }> = ({ sample, values }) =>
  sample.document(values);

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

  private diagnostics: Diagnostic[] = [];
  private started = 0;
  readonly preview = pdfResource(
    selected,
    () => ({ sample: this.sample(), values: this.values() }),
    {
      options: () => {
        this.diagnostics = [];
        this.started = performance.now();
        return {
          ...this.sample().options?.(this.values()),
          accessible: this.tagged(),
          onDiagnostic: (d) => this.diagnostics.push(d),
        };
      },
    },
  );

  readonly stats = computed(() => {
    const file = this.preview.value();
    if (!file) return undefined;
    const pages = countPages(file.bytes);
    return {
      ms: performance.now() - this.started,
      label: `${pages} ${pages === 1 ? "page" : "pages"} · ${(file.bytes.length / 1024).toFixed(1)} KB`,
      diagnostics: this.diagnostics,
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
    return this.pdf.download(
      selected,
      this.input(),
      `${this.sample().id}.pdf`,
      this.renderOptions(),
    );
  }
  open() {
    return this.pdf.open(selected, this.input(), this.renderOptions());
  }

  private input() {
    return { sample: this.sample(), values: this.values() };
  }
  private renderOptions() {
    return { ...this.sample().options?.(this.values()), accessible: this.tagged() };
  }

  error(e: unknown) {
    return String((e as Error)?.stack ?? e);
  }
}

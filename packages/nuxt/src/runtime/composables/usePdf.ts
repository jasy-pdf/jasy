import { ref, shallowRef, onMounted, onScopeDispose } from "vue";
import type { Component } from "vue";
import { renderToPdf } from "@jasy/vue";
import type { RenderOptions } from "@jasy/pdf";

export interface UsePdfOptions {
  /** Props passed to the rendered component. A function is re-read on each render (reactive). */
  props?: Record<string, any> | (() => Record<string, any>);
  /** Render immediately on mount (client only). Default false. */
  immediate?: boolean;
  /** Engine options forwarded to renderToPdf (e.g. onOverflow). */
  renderOptions?: RenderOptions;
}

/**
 * Render a PDF component to bytes in the browser. `open()` / `download()` render on demand and reuse the
 * result, so one click is one render whether or not `immediate` pre-rendered. `render()` forces a fresh
 * one (e.g. after the data changed). The object URL is revoked on re-render and scope dispose.
 */
export function usePdf(component: Component, options: UsePdfOptions = {}) {
  const bytes = shallowRef<Uint8Array>();
  const url = ref<string>();
  const pending = ref(false);
  const error = ref<unknown>();
  let inflight: Promise<void> | null = null;

  function revoke() {
    if (url.value) {
      URL.revokeObjectURL(url.value);
      url.value = undefined;
    }
  }

  async function run() {
    if (typeof document === "undefined") return; // client-only (needs a Blob URL)
    pending.value = true;
    error.value = undefined;
    try {
      const props = typeof options.props === "function" ? options.props() : options.props;
      const out = await renderToPdf(component, props, options.renderOptions);
      bytes.value = out;
      revoke();
      url.value = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
    } catch (e) {
      error.value = e;
    } finally {
      pending.value = false;
    }
  }

  /** Force a fresh render. Concurrent calls share the one in-flight render. */
  function render() {
    inflight ??= run().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  /** Render only if nothing is ready yet (reusing an in-flight render); otherwise keep the current PDF. */
  async function ensure() {
    if (!url.value) await render();
  }

  async function open() {
    await ensure();
    if (url.value) window.open(url.value, "_blank");
  }

  async function download(filename = "document.pdf") {
    await ensure();
    if (!url.value) return;
    const a = document.createElement("a");
    a.href = url.value;
    a.download = filename;
    a.click();
  }

  onScopeDispose(revoke);
  if (options.immediate) onMounted(render);

  return { bytes, url, pending, error, render, download, open };
}

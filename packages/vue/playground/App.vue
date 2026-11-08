<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { renderToPdf } from "@jasy/vue";
import type { Diagnostic } from "@jasy/pdf";
import { SAMPLES, type Assets, type Sample } from "./samples";
import fontUrl from "./assets/GreatVibes-Regular.ttf?url";
import photoUrl from "./assets/photo.jpg?url";
import logoUrl from "./assets/logo.png?url";

const GROUPS = ["Start", "Documents", "jasy's power"] as const;
const initialValues = (s: Sample) =>
  Object.fromEntries((s.controls ?? []).map((c) => [c.key, c.initial]));
const fromHash = () => SAMPLES.find((s) => s.id === location.hash.slice(1)) ?? SAMPLES[0];

const ASSET_URLS: Record<keyof Assets, string> = { font: fontUrl, photo: photoUrl, logo: logoUrl };
const loaded = new Map<keyof Assets, Promise<Uint8Array>>();

/** One fetch per file, shared by every sample; a failed one is forgotten, so the next render retries. */
function asset(key: keyof Assets): Promise<Uint8Array> {
  let bytes = loaded.get(key);
  if (!bytes) {
    bytes = fetch(ASSET_URLS[key]).then(async (r) => {
      if (!r.ok) throw new Error(`${ASSET_URLS[key]}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    });
    bytes.catch(() => loaded.delete(key));
    loaded.set(key, bytes);
  }
  return bytes;
}

/** Only the files `s` asks for, so a sample without assets never waits for (or fails on) one. */
async function assetsFor(s: Sample): Promise<Assets> {
  const keys = s.assets ?? [];
  const bytes = await Promise.all(keys.map(asset));
  return Object.fromEntries(keys.map((k, i) => [k, bytes[i]])) as unknown as Assets;
}

interface Result {
  sampleId: string;
  url: string;
  ms: number;
  pages: number;
  kb: number;
  diagnostics: Diagnostic[];
}

// Page objects are written uncompressed, so counting them is a cheap, honest page count.
const countPages = (bytes: Uint8Array) =>
  (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

const sample = shallowRef(fromHash());
const values = ref<Record<string, any>>(initialValues(sample.value));
const tagged = ref(false);
const showCode = ref(true);
const result = shallowRef<Result>();
const error = ref<string>();
let run = 0;
let url: string | undefined;

// The hash is the selection, so back/forward and an edited URL switch the sample too.
function follow() {
  sample.value = fromHash();
  values.value = initialValues(sample.value);
}
const select = (s: Sample) => (location.hash = s.id);
onMounted(() => addEventListener("hashchange", follow));
onUnmounted(() => {
  removeEventListener("hashchange", follow);
  if (url) URL.revokeObjectURL(url);
});

// Render on every change, debounced for typing and sliders; a stale render never overwrites a newer one.
let timer: ReturnType<typeof setTimeout> | undefined;
watch(
  [sample, values, tagged],
  () => {
    const ticket = ++run;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const s = sample.value;
      const diagnostics: Diagnostic[] = [];
      try {
        const assets = await assetsFor(s);
        if (ticket !== run) return;
        const started = performance.now();
        const bytes = await renderToPdf(s.component, s.props?.(values.value, assets), {
          ...s.options?.(values.value),
          accessible: tagged.value,
          onDiagnostic: (d) => diagnostics.push(d),
        });
        const ms = performance.now() - started;
        if (ticket !== run) return;
        if (url) URL.revokeObjectURL(url);
        url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        error.value = undefined;
        result.value = {
          sampleId: s.id,
          url,
          ms,
          pages: countPages(bytes),
          kb: bytes.length / 1024,
          diagnostics,
        };
      } catch (e: any) {
        if (ticket === run) error.value = String(e?.stack ?? e);
      }
    }, 150);
  },
  { deep: true, immediate: true },
);

// Only a successful render of the sample on screen is shown or offered for download.
const current = computed(() =>
  !error.value && result.value?.sampleId === sample.value.id ? result.value : undefined,
);
const groups = GROUPS.map((g) => ({ name: g, samples: SAMPLES.filter((s) => s.group === g) }));
</script>

<template>
  <div :class="showCode ? 'app' : 'app no-code'">
    <aside>
      <div class="brand">
        <img :src="logoUrl" alt="" />
        <div>
          <strong>@jasy/vue</strong>
          <span>playground</span>
        </div>
      </div>
      <nav v-for="g in groups" :key="g.name">
        <h2>{{ g.name }}</h2>
        <button
          v-for="s in g.samples"
          :key="s.id"
          :class="{ active: s.id === sample.id }"
          @click="select(s)"
        >
          <span class="title">{{ s.title }}</span>
          <span class="look">{{ s.look }}</span>
        </button>
      </nav>
      <p class="footnote">Every PDF is rendered right here, in your browser. No server.</p>
    </aside>

    <section class="code">
      <header>
        <span>{{ sample.file }}</span>
      </header>
      <div v-if="sample.controls" class="controls">
        <label v-for="c in sample.controls" :key="c.key">
          <span>{{ c.label }}</span>
          <input v-if="c.type === 'text'" v-model="values[c.key]" spellcheck="false" />
          <template v-else>
            <input v-model.number="values[c.key]" type="range" :min="c.min" :max="c.max" />
            <output>{{ values[c.key] }}</output>
          </template>
        </label>
      </div>
      <pre><code>{{ sample.source }}</code></pre>
    </section>

    <section class="viewer">
      <header>
        <button class="toggle" @click="showCode = !showCode">
          {{ showCode ? "Hide code" : "Show code" }}
        </button>
        <span v-if="current" class="stats">
          <b>{{ current.ms.toFixed(0) }} ms</b> · {{ current.pages }}
          {{ current.pages === 1 ? "page" : "pages" }} · {{ current.kb.toFixed(1) }} KB
        </span>
        <label class="tagged" title="A structure tree for screen readers (PDF/UA)">
          <input v-model="tagged" type="checkbox" />
          Tagged PDF
        </label>
        <a v-if="current" class="download" :href="current.url" :download="`${sample.id}.pdf`"
          >Download</a
        >
      </header>
      <ul v-if="current && current.diagnostics.length" class="diagnostics">
        <li v-for="(d, i) in current.diagnostics" :key="i">
          <code>{{ d.code }}</code> {{ d.message }}
        </li>
      </ul>
      <pre v-if="error" class="error">{{ error }}</pre>
      <iframe
        v-else-if="current"
        :key="current.url"
        :src="`${current.url}#view=FitH`"
        title="PDF"
      />
    </section>
  </div>
</template>

<style src="./app.css"></style>

<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import { renderToPdf } from "@jasy/vue";
import VuePdfEmbed from "vue-pdf-embed";
import Hello from "./samples/Hello.vue";
import Invoice from "./samples/Invoice.vue";
import Invitation from "./samples/Invitation.vue";
import Showcase from "./samples/Showcase.vue";
import Report from "./samples/Report.vue";
import Transparency from "./samples/Transparency.vue";
import fontUrl from "./assets/GreatVibes-Regular.ttf?url";
import imgUrl from "./assets/photo.jpg?url";
import logoUrl from "./assets/logo.png?url";

type AssetKey = "font" | "image" | "logo";
const samples: { label: string; comp: any; assets?: AssetKey[] }[] = [
  { label: "Hello world", comp: Hello },
  { label: "Invoice", comp: Invoice },
  { label: "Report", comp: Report },
  { label: "Invitation", comp: Invitation },
  { label: "Showcase", comp: Showcase, assets: ["font", "image"] },
  { label: "Transparency", comp: Transparency, assets: ["logo"] },
];

// Each sample gets ONLY the keys it declares (above), never the whole cache - a stray asset would fall
// through to the sample's root <Document> and bind to a real prop like `font` (then crash as a bad family).
let assetCache: Record<AssetKey, Uint8Array> | null = null;
async function loadAssets() {
  if (!assetCache) {
    const grab = (u: string) =>
      fetch(u)
        .then((r) => r.arrayBuffer())
        .then((b) => new Uint8Array(b));
    const [font, image, logo] = await Promise.all([grab(fontUrl), grab(imgUrl), grab(logoUrl)]);
    assetCache = { font, image, logo };
  }
  return assetCache;
}

// Remember the choice across the full reload Vite does when you edit a sample, so it feels live.
const STORAGE = "jasy-vue-sample";
const currentIndex = ref(Number(sessionStorage.getItem(STORAGE)) || 0);
const pdfUrl = ref<string>();
const error = ref<string>();
const building = ref(false);
const downloadName = computed(
  () => samples[currentIndex.value].label.toLowerCase().replace(/\s+/g, "-") + ".pdf",
);

async function render() {
  building.value = true;
  error.value = undefined;
  try {
    // 100% in the browser: the @jasy/pdf engine runs right here, no server. Vue component -> PDF bytes.
    const sample = samples[currentIndex.value];
    let props: Record<string, Uint8Array> | undefined;
    if (sample.assets) {
      const cache = await loadAssets();
      props = Object.fromEntries(sample.assets.map((k) => [k, cache[k]]));
    }
    const bytes = await renderToPdf(sample.comp, props);
    // vue-pdf-embed paints the PDF onto a <canvas>, so it always shows inline and never downloads.
    pdfUrl.value = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  } catch (e: any) {
    error.value = String(e?.message ?? e);
  } finally {
    building.value = false;
  }
}

function select(i: number) {
  currentIndex.value = i;
  sessionStorage.setItem(STORAGE, String(i));
  render();
}

onMounted(render);
</script>

<template>
  <div class="app">
    <header>
      <span class="brand">@jasy/vue</span>
      <nav>
        <button
          v-for="(s, i) in samples"
          :key="s.label"
          :class="{ active: i === currentIndex }"
          @click="select(i)"
        >
          {{ s.label }}
        </button>
      </nav>
      <a v-if="pdfUrl" class="download" :href="pdfUrl" :download="downloadName">↓ Download</a>
      <span class="hint">{{ building ? "rendering…" : "100% in your browser · no server" }}</span>
    </header>
    <main>
      <pre v-if="error" class="error">{{ error }}</pre>
      <div v-else class="viewer">
        <VuePdfEmbed v-if="pdfUrl" :key="pdfUrl" :source="pdfUrl" class="page" />
      </div>
    </main>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  background: #0a2348;
  color: #fff;
  font-size: 14px;
}
.brand {
  font-weight: 700;
}
nav {
  display: flex;
  gap: 6px;
}
nav button {
  padding: 5px 13px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: transparent;
  color: #cdd9ee;
  font-size: 13px;
  cursor: pointer;
}
nav button.active {
  background: #f3dc29;
  border-color: #f3dc29;
  color: #0a2348;
  font-weight: 700;
}
.download {
  margin-left: auto;
  padding: 5px 13px;
  border: 1px solid #f3dc29;
  border-radius: 6px;
  color: #f3dc29;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition:
    background 0.15s,
    color 0.15s;
}
.download:hover {
  background: #f3dc29;
  color: #0a2348;
}
.hint {
  opacity: 0.6;
  font-size: 12px;
}
main {
  flex: 1;
  background: #525659;
  overflow: auto;
}
.viewer {
  display: flex;
  justify-content: center;
  padding: 28px;
}
.page {
  width: 100%;
  max-width: 820px;
  background: #fff;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
}
.error {
  margin: 0;
  padding: 18px;
  color: #fca5a5;
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  font-size: 13px;
}
</style>

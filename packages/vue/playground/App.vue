<script setup lang="ts">
import { ref, onMounted } from "vue";
import { toDocumentDescriptor } from "@jasy/vue";
import VuePdfEmbed from "vue-pdf-embed";
import Hello from "./samples/Hello.vue";
import Invoice from "./samples/Invoice.vue";
import Invitation from "./samples/Invitation.vue";

const samples = [
  { label: "Hello world", comp: Hello },
  { label: "Invoice", comp: Invoice },
  { label: "Invitation", comp: Invitation },
];

// Remember the choice across the full reload Vite does when you edit a sample, so it feels live.
const STORAGE = "jasy-vue-sample";
const currentIndex = ref(Number(sessionStorage.getItem(STORAGE)) || 0);
const pdfUrl = ref<string>();
const error = ref<string>();
const building = ref(false);

async function render() {
  building.value = true;
  error.value = undefined;
  try {
    // Browser: Vue component -> serialisable descriptor. Server: descriptor -> PDF (the Node engine).
    const descriptor = toDocumentDescriptor(samples[currentIndex.value].comp);
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(descriptor),
    });
    if (!res.ok) throw new Error(await res.text());
    // vue-pdf-embed paints the PDF onto a <canvas>, so it always shows inline and never downloads.
    pdfUrl.value = URL.createObjectURL(await res.blob());
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
      <span class="hint">{{ building ? "rendering…" : "edit samples/*.vue" }}</span>
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
  font-family: system-ui, -apple-system, sans-serif;
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
.hint {
  margin-left: auto;
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

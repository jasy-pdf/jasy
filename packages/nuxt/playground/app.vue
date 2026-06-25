<script setup lang="ts">
import Invoice from "./Invoice.vue";

// usePdf is auto-imported by @jasy/nuxt. open() renders on demand and reuses the result, so one click is
// one render. Add `{ immediate: true }` to pre-render on mount - the button still won't render twice.
const { pending, open } = usePdf(Invoice);
</script>

<template>
  <div class="wrap">
    <h1>@jasy/nuxt</h1>
    <p class="lead">One PDF library, two places to render it.</p>

    <div class="cards">
      <section class="card">
        <h2>Client</h2>
        <p>Render a Vue component to a PDF in the browser - no server round-trip.</p>
        <button :disabled="pending" @click="open">
          {{ pending ? "Rendering..." : "Render on client" }}
        </button>
      </section>

      <section class="card">
        <h2>Server</h2>
        <p>
          A Nitro route that builds the PDF with the @jasy/pdf tree API - rendered fresh on every
          request.
        </p>
        <a class="btn" href="/api/hello" target="_blank">Render on server &rarr;</a>
      </section>

      <section class="card">
        <h2>Cached</h2>
        <p>
          The same route wrapped with <code>cache</code>. The timestamp inside stays put on repeat
          requests within 30s - served from Nitro's cache, not re-rendered.
        </p>
        <a class="btn" href="/api/cached" target="_blank">Open cached route &rarr;</a>
      </section>
    </div>
  </div>
</template>

<style>
body {
  margin: 0;
  background: #f8fafc;
}
.wrap {
  font-family: system-ui, sans-serif;
  max-width: 760px;
  margin: 0 auto;
  padding: 48px 20px;
  color: #1f2937;
}
h1 {
  color: #0a2348;
  margin: 0;
}
.lead {
  color: #64748b;
  margin: 6px 0 28px;
}
.cards {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}
.card {
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 22px;
}
.card h2 {
  margin: 0 0 6px;
  color: #0a2348;
}
.card p {
  color: #64748b;
  margin: 0 0 18px;
  line-height: 1.5;
}
button,
.btn {
  margin-top: auto;
  align-self: flex-start;
  display: inline-block;
  padding: 9px 16px;
  border: 1px solid #0a2348;
  border-radius: 8px;
  background: #0a2348;
  color: #fff;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
code {
  background: #eef2f7;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.9em;
}
</style>

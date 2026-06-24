import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 100% browser: the @jasy/pdf engine renders the PDF client-side (no server, no dev middleware).
export default defineConfig({
  plugins: [vue()],
  // vue-pdf-embed bundles pdf.js + its worker; excluding it from pre-bundling keeps that worker happy.
  optimizeDeps: { exclude: ["vue-pdf-embed"] },
});

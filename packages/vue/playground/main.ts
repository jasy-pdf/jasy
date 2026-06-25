import { createApp } from "vue";
import { jasyVue } from "@jasy/vue";
import App from "./App.vue";

// Register the components globally under a prefix -> <PdfRow>, <PdfText>, … (no per-file imports).
createApp(App).use(jasyVue, { prefix: "Pdf" }).mount("#app");

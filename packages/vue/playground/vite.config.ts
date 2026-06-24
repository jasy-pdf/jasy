import { defineConfig, type Connect } from "vite";
import vue from "@vitejs/plugin-vue";
import type { IncomingMessage, ServerResponse } from "node:http";
import { buildDocument, renderToBytes } from "@jasy/pdf";

// Dev endpoint: the browser builds the descriptor (via @jasy/vue) and POSTs it here; the @jasy/pdf
// engine (Node) turns it into a PDF. This keeps the Node-only render out of the browser bundle -
// exactly the @jasy/vue split. In a real app this is a server route (Nitro, Express, …) instead.
function jasyRender() {
  return {
    name: "jasy-render",
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(
        "/api/render",
        (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
          if (req.method !== "POST") return next();
          let body = "";
          req.on("data", (c) => (body += c));
          req.on("end", async () => {
            try {
              const bytes = await renderToBytes(buildDocument(JSON.parse(body)));
              res.setHeader("Content-Type", "application/pdf");
              res.end(Buffer.from(bytes));
            } catch (e: any) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "text/plain");
              res.end(String(e?.stack ?? e?.message ?? e));
            }
          });
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [vue(), jasyRender()],
  // vue-pdf-embed bundles pdf.js + its worker; excluding it from pre-bundling keeps that worker happy.
  optimizeDeps: { exclude: ["vue-pdf-embed"] },
});

import { Document, Page, Text, renderToBytes } from "@jasy/pdf";

// A PDF built entirely server-side with the @jasy/pdf tree API - no Vue, no browser. Open /api/hello.
export default defineEventHandler(async (event) => {
  const doc = Document([
    Page({ size: "A4", margin: 56 }, [
      Text("Hello from @jasy/nuxt", { size: 28, bold: true, color: "#0a2348" }),
      Text("Built in a Nitro server route with the @jasy/pdf tree API - no Vue, no browser.", {
        size: 13,
        color: "gray",
      }),
    ]),
  ]);

  setResponseHeader(event, "content-type", "application/pdf");
  setResponseHeader(event, "content-disposition", 'inline; filename="hello.pdf"');
  return await renderToBytes(doc);
});

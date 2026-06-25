// Cached for 30s (key = path + query). The timestamp baked into the PDF stays the same on repeat
// requests within the window - proof it served from cache instead of re-rendering. Open /api/cached.
export default definePdfHandler(
  () =>
    Document([
      Page({ size: "A4", margin: 56 }, [
        Text("Cached PDF", { size: 26, bold: true, color: "#0a2348" }),
        Text(`Rendered at ${new Date().toISOString()}`, { size: 13, color: "gray" }),
      ]),
    ]),
  { cache: { maxAge: 30 } },
);

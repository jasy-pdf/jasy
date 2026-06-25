// Zero imports: Document/Page/Text + definePdfHandler are auto-imported in server/. Open /api/hello.
export default definePdfHandler(() =>
  Document([
    Page({ size: "A4", margin: 56 }, [
      Text("Hello from @jasy/nuxt", { size: 28, bold: true, color: "#0a2348" }),
      Text("Built server-side with definePdfHandler - zero imports, no Vue.", {
        size: 13,
        color: "gray",
      }),
    ]),
  ]),
);

// The route that ISSUE-11 broke: elements are built HERE, in the consumer's code, from names the module
// auto-imported, and rendered by @jasy/pdf. If the consumer's "@jasy/pdf" is a different module record
// than the module runtime's, the registry cannot render a single one of these elements.
export default defineEventHandler(async () => {
  const doc = Document([Page([Text("HELLO FROM NITRO")])]);
  // Uncompressed so the test can look at the operators instead of trusting the byte count.
  const bytes = await renderToBytes(doc, { compress: false });
  return { bytes: bytes.length, pdf: new TextDecoder("latin1").decode(bytes) };
});

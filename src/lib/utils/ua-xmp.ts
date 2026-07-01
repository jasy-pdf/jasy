const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * XMP metadata packet that identifies the document as PDF/UA-1 (accessible). A fully conformant PDF/UA file
 * also needs a displayed title (the /ViewerPreferences /DisplayDocTitle flag + this dc:title) and embedded
 * fonts - the same font rule PDF/A has, so the standard-14 fonts do not qualify.
 */
export function uaXmp(opts: { title?: string; lang?: string } = {}): string {
  const title = esc(opts.title ?? "");
  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">` +
    `<rdf:Description rdf:about="" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">` +
    `<pdfuaid:part>1</pdfuaid:part>` +
    `</rdf:Description>` +
    `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title}</rdf:li></rdf:Alt></dc:title>` +
    `</rdf:Description>` +
    `</rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}

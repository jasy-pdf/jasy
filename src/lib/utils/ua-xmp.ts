// Escapes text for XML AND keeps the packet ASCII-safe: XML metacharacters become entities, and any
// non-ASCII / control character becomes a numeric character reference. The PDF writer emits the
// metadata stream one byte per char (Latin-1), so a raw non-ASCII title like "R\u00E9sum\u00E9" would corrupt
// the UTF-8 XMP (and misalign /Length); escaping keeps every char <= 0x7e.
const esc = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[^ -~]/gu, (c) => `&#${c.codePointAt(0)};`); // any non printable-ASCII char

/**
 * XMP metadata packet that identifies the document as PDF/UA-1 (accessible). A fully conformant PDF/UA file
 * also needs a displayed title (the /ViewerPreferences /DisplayDocTitle flag + this dc:title) and embedded
 * fonts - the same font rule PDF/A has, so the standard-14 fonts do not qualify. Language is declared once
 * in the catalog `/Lang`, not here (the dc:title uses `x-default`), so this takes only the title.
 */
export function uaXmp(opts: { title?: string } = {}): string {
  const title = esc(opts.title ?? "");
  return (
    // The xpacket marker is the 3-byte UTF-8 BOM (EF BB BF) written as Latin-1 chars so the
    // single-byte writer emits it verbatim - a literal U+FEFF would be mangled to "?".
    `<?xpacket begin="\u00EF\u00BB\u00BF" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
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

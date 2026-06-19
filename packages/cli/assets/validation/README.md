# Vendored validation rules

The official **EN 16931 / XRechnung Schematron** business rules, compiled to SaxonJS SEF
(`.sef.json`, gzipped) so the CLI validates invoices **locally** via `saxon-js` — no upload, DSGVO-safe.
This covers the XML conformance (the legally decisive part); PDF/A-3 (veraPDF) is a separate Java check.

| File                      | Rules                                               | Upstream                                                                                                                                           |
| ------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `en16931-cii.sef.json.gz` | EN 16931 for UN/CEFACT **CII** (ZUGFeRD / Factur-X) | [ConnectingEurope/eInvoicing-EN16931](https://github.com/ConnectingEurope/eInvoicing-EN16931) — Apache-2.0, `cii/xslt/EN16931-CII-validation.xslt` |

**To refresh / add a profile:** fetch the upstream `.xslt`, then
`xslt3 -xsl:<file>.xslt -export:<out>.sef.json -nogo` and `gzip` the result into this folder.
(`xslt3` is the SaxonJS compiler, a devDependency.)

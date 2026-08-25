# Vendored UBL 2.1 schemas

The **OASIS UBL 2.1** XSD set for the `Invoice` document - used to XSD-validate the XML produced by
`toUBL`, exactly as `../cii` does for `toCII`.

- `maindoc/UBL-Invoice-2.1.xsd` - entry point; imports the modules in `common/` by relative path, so
  the two-directory layout matters.

**Origin / licence:** taken verbatim from
[docs.oasis-open.org/ubl/os-UBL-2.1/xsd](https://docs.oasis-open.org/ubl/os-UBL-2.1/xsd)
(OASIS, freely redistributable with attribution).

**Why it is here.** The EN 16931 schematron checks business rules, not element SEQUENCE - so a file
can pass every validator we run and still be schema-invalid. Vendoring the schema is what let
`tests/ubl-order.test.ts` find two real bugs the day it was added: `cac:DeliveryLocation` carried a
`cac:PostalAddress` (a LocationType takes `cac:Address`), and the item identifiers were emitted
seller-before-buyer where UBL declares the reverse.

Not published: `package.json` ships only `dist` and `assets`, so this costs repository size, nothing
in the npm tarball.

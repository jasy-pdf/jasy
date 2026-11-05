import { Box, Column, Divider, Document, Image, Page, Row, Text } from "@jasy/react";

const PRODUCTS = [
  { name: "Origami Crane Kit", qty: 3, price: 12.5 },
  { name: "Washi Tape Set", qty: 2, price: 8.0 },
  { name: "Calligraphy Pen", qty: 1, price: 24.9 },
];

// The font and the photo arrive as raw bytes, fetched in the browser - no filesystem, no server.
export default function FontsAndImages({ font, photo }: { font: Uint8Array; photo: Uint8Array }) {
  const total = PRODUCTS.reduce((sum, p) => sum + p.qty * p.price, 0);
  return (
    // `fonts` registers the .ttf under a name; `font` on a Text then selects it.
    <Document fonts={{ GreatVibes: font }}>
      <Page size="A4" gap={14}>
        <Row justify="between" align="center">
          <Text font="GreatVibes" size={44} color="#1450aa">
            Jasy Atelier
          </Text>
          <Image src={photo} width={84} height={84} fit="cover" radius={42} />
        </Row>
        <Text size={11} color="#64748b">
          Custom .ttf · image bytes · a circular crop · computed totals
        </Text>
        <Divider />

        <Box bg="#0a2348" padding={10} radius={4}>
          <Row justify="between">
            <Text size={11} bold color="#ffffff">
              Product
            </Text>
            <Text size={11} bold color="#ffffff">
              Qty × Price = Total
            </Text>
          </Row>
        </Box>
        <Column gap={7}>
          {PRODUCTS.map((p) => (
            <Row key={p.name} justify="between">
              <Text size={12}>{p.name}</Text>
              <Text size={12}>
                {p.qty} × {p.price.toFixed(2)} = {(p.qty * p.price).toFixed(2)} €
              </Text>
            </Row>
          ))}
        </Column>

        <Divider />
        <Row justify="between" align="center">
          <Text size={14} bold>
            Total
          </Text>
          <Text font="GreatVibes" size={22} color="#1450aa">
            {total.toFixed(2)} €
          </Text>
        </Row>
      </Page>
    </Document>
  );
}

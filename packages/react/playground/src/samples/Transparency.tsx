import { Box, Document, Image, Page, Row, Text } from "@jasy/react";

const PANELS = ["#0a2348", "#0d9488", "#fb7185"];

// A PNG with an alpha channel, decoded in the browser and embedded with a real /SMask.
export default function Transparency({ logo }: { logo: Uint8Array }) {
  return (
    <Document size={12} color="#1f2937">
      <Page size="A4" gap={20}>
        <Text size={22} bold color="#0a2348">
          Transparent PNG
        </Text>
        <Text color="#64748b">
          The transparency composites over whatever sits behind it - the panel shows through, not a
          white rectangle.
        </Text>
        <Row gap={16} align="center">
          {PANELS.map((bg) => (
            <Box key={bg} bg={bg} padding={16} radius={8}>
              <Image src={logo} width={100} height={100} fit="contain" />
            </Box>
          ))}
        </Row>
      </Page>
    </Document>
  );
}

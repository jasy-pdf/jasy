import { Box, Document, Page, Text } from "@jasy/react";

export default function Hello({ name }: { name: string }) {
  return (
    <Document>
      <Page size="A4" gap={14}>
        <Text size={30} bold color="#1450aa">
          Hello, {name}
        </Text>
        <Text size={13} color="#475569">
          This whole document is a React component tree, rendered to a real PDF by @jasy/react -
          right here in your browser. Change the name, or edit this file and watch it rebuild.
        </Text>
        <Box bg="#eef2ff" padding={16} radius={6}>
          <Text size={12}>
            A Box with a background, padding and rounded corners, holding a Text.
          </Text>
        </Box>
      </Page>
    </Document>
  );
}

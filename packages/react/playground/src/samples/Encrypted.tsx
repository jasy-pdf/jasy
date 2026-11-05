import { Box, Document, Page, Text } from "@jasy/react";

// The password is a render option, not part of the tree: renderToPdf(<Encrypted />, { encrypt }).
export default function Encrypted() {
  return (
    <Document>
      <Page size="A4" gap={16}>
        <Text size={28} bold color="#0a2348">
          Confidential
        </Text>
        <Text size={13} color="#475569">
          This document is encrypted with AES-256. A PDF viewer asks for the password before it
          shows anything - and it was rendered right here in your browser.
        </Text>
        <Box bg="#fef3c7" padding={16} radius={6}>
          <Text size={12} color="#92400e">
            Salary review, Q3 projections, and other things you would not send in plain text.
          </Text>
        </Box>
      </Page>
    </Document>
  );
}

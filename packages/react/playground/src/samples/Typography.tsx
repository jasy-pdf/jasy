import { Column, Document, Expanded, Page, Row, Span, Text } from "@jasy/react";

const LOREM =
  "Good typography is invisible. The words sit evenly on the line, the spaces stay calm, and the eye moves on without noticing any of it. jasy measures every glyph with the font's own metrics and kerns each pair, so what is measured is exactly what is drawn.";

export default function Typography() {
  return (
    <Document size={11} color="#1f2937">
      <Page size="A4" gap={16}>
        <Text size={11} bold color="#1450aa" letterSpacing={4} textTransform="uppercase">
          Typography
        </Text>
        <Text size={40} bold color="#0a2348">
          AVATAR Wave, kerned.
        </Text>

        <Text size={13}>
          Spans mix <Span bold>bold</Span>, <Span italic>italic</Span>,{" "}
          <Span color="#1450aa">color</Span>, <Span underline>underline</Span>,{" "}
          <Span strikethrough>strikethrough</Span>, a footnote
          <Span verticalAlign="super" size={8}>
            1
          </Span>{" "}
          and a{" "}
          <Span href="https://jasy.dev" color="#1450aa" underline>
            link
          </Span>{" "}
          - in one paragraph that wraps as one.
        </Text>

        <Row gap={20}>
          <Expanded>
            <Column gap={4}>
              <Text size={9} bold color="#64748b">
                JUSTIFIED
              </Text>
              <Text align="justify" lineHeight={1.5}>
                {LOREM}
              </Text>
            </Column>
          </Expanded>
          <Expanded>
            <Column gap={4}>
              <Text size={9} bold color="#64748b">
                FIRST-LINE INDENT
              </Text>
              <Text textIndent={18} lineHeight={1.5}>
                {LOREM}
              </Text>
            </Column>
          </Expanded>
        </Row>

        <Column gap={4}>
          <Text size={9} bold color="#64748b">
            TWO LINES, THEN AN ELLIPSIS
          </Text>
          <Text maxLines={2} overflow="ellipsis">
            {`${LOREM} ${LOREM}`}
          </Text>
        </Column>

        <Row gap={20}>
          <Text size={18} letterSpacing={6}>
            spaced
          </Text>
          <Text size={18} wordSpacing={14}>
            word spacing too
          </Text>
          <Text size={18} textTransform="capitalize">
            capitalize every word
          </Text>
        </Row>

        <Text size={9} color="#94a3b8">
          ¹ Raised with verticalAlign="super" - it shifts the baseline, the size is yours to pick.
        </Text>
      </Page>
    </Document>
  );
}

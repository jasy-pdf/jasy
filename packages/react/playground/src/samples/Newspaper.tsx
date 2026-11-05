import {
  Box,
  Column,
  ColumnBreak,
  Document,
  Expanded,
  Flow,
  KeepTogether,
  Page,
  PageBreak,
  PageCount,
  PageNumber,
  Region,
  Row,
  SplitView,
  Table,
  TableCell,
  TableRow,
  Text,
} from "@jasy/react";

const NEWS = [
  "Rail freight volumes rose for the third quarter in a row, driven by container traffic between the North Sea ports and the inland terminals.",
  "Operators report that most new capacity went to night slots, which leaves daytime passenger timetables untouched for now.",
  "The regional council approved the second phase of the harbor bridge, with construction expected to start in early spring.",
  "Local bakeries have joined forces to buy flour directly from three mills in the valley, cutting their costs by almost a tenth.",
  "Weather services expect a dry autumn, which helps the late harvest but worries the shipping companies on the upper river.",
  "Schools in the district will test a four-day week for older students, with the fifth day reserved for projects and internships.",
];
const story = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `${NEWS[(from + i) % 6]} ${NEWS[(from + i + 2) % 6]}`);
const Paragraphs = ({ n, from, size }: { n: number; from?: number; size?: number }) =>
  story(n, from).map((p, i) => (
    <Text key={i} size={size}>
      {p}
    </Text>
  ));

const PRICES = Array.from({ length: 12 }, (_, i) => ({
  lot: `${["Wheat", "Barley", "Rye", "Oats"][i % 4]} lot ${i + 1}`,
  price: (180 + i * 7.5).toFixed(2),
}));
const BUDGET = Array.from({ length: 10 }, (_, i) => ({
  project: `Project ${String.fromCharCode(65 + i)}`,
  amount: `${(1.2 + i * 0.35).toFixed(2)} m`,
  status: i % 3 ? "on track" : "delayed",
}));

const Footer = () => (
  <Row>
    <Expanded>
      <Text size={7} color="#94a3b8">
        The Valley Courier
      </Text>
    </Expanded>
    <Row gap={3}>
      <Text size={7} color="#94a3b8">
        Page
      </Text>
      <PageNumber size={7} color="#94a3b8" />
      <Text size={7} color="#94a3b8">
        of
      </Text>
      <PageCount size={7} color="#94a3b8" />
    </Row>
  </Row>
);

export default function Newspaper() {
  return (
    <Document size={9} lineHeight={1.4} color="#1f2937">
      <Page size="A4" margin={36} gap={10} footer={<Footer />}>
        {/* Newspaper columns: no layout to write. */}
        <Text size={30} bold color="#1450aa">
          THE VALLEY COURIER
        </Text>
        <Box height={1.5} bg="#1450aa" />
        <SplitView columns={3} colGap={16} rowGap={7}>
          <KeepTogether>
            <Text size={13} bold color="#1450aa">
              Freight on the rise
            </Text>
            <Text>{story(1)[0]}</Text>
          </KeepTogether>
          <Paragraphs n={4} from={1} />
          <Box bg="#eef3fb" padding={8} radius={3}>
            <Text size={11} italic color="#1450aa">
              "We plan for the river we have, not the river we wish for."
            </Text>
          </Box>
          <Paragraphs n={3} from={5} />
          <Text size={13} bold color="#1450aa">
            Market prices
          </Text>
          <Table columns={["1fr", "auto"]} cellPadding={3} rule="#c8d3e8">
            <TableRow header>
              <TableCell>Lot</TableCell>
              <TableCell>EUR/t</TableCell>
            </TableRow>
            {PRICES.map((r) => (
              <TableRow key={r.lot}>
                <TableCell>{r.lot}</TableCell>
                <TableCell>{r.price}</TableCell>
              </TableRow>
            ))}
          </Table>
          <Paragraphs n={4} from={2} />
          <ColumnBreak />
          <KeepTogether>
            <Text size={13} bold color="#1450aa">
              Schools try a four-day week
            </Text>
            <Text>{story(1, 3)[0]}</Text>
          </KeepTogether>
          <Paragraphs n={8} from={4} />
        </SplitView>
        <Text size={10} italic>
          This line follows the columns, right where they end.
        </Text>

        {/* A layout of your own: `page` draws one page of the Flow, each Region a place the content flows. */}
        <PageBreak />
        <Flow
          gap={8}
          page={({ index }) => (
            <Box border="#1450aa" padding={12} radius={4}>
              <Column gap={10}>
                {index === 0 ? (
                  <Text size={18} bold color="#1450aa">
                    Annual Infrastructure Report
                  </Text>
                ) : (
                  <Text size={8} italic color="#1450aa">
                    Annual Infrastructure Report, continued
                  </Text>
                )}
                <Row gap={14}>
                  <Expanded>
                    <Region />
                  </Expanded>
                  <Box bg="#f3f5f9" padding={8}>
                    <Region width={150} />
                  </Box>
                </Row>
              </Column>
            </Box>
          )}
        >
          <Text size={12} bold>
            Summary
          </Text>
          <Paragraphs n={4} size={10} />
          <Text size={12} bold>
            Two-column detail
          </Text>
          <SplitView columns={2} colGap={12} rowGap={6}>
            <Paragraphs n={6} from={4} />
          </SplitView>
          <Text size={12} bold color="#1450aa">
            Budget
          </Text>
          <Table columns={["1fr", "auto", "auto"]} cellPadding={3} cellBorder="#bbb">
            <TableRow header>
              <TableCell>Project</TableCell>
              <TableCell>Budget</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
            {BUDGET.map((b) => (
              <TableRow key={b.project}>
                <TableCell>
                  <Text size={8}>{b.project}</Text>
                </TableCell>
                <TableCell>
                  <Text size={8}>{b.amount}</Text>
                </TableCell>
                <TableCell>
                  <Text size={8}>{b.status}</Text>
                </TableCell>
              </TableRow>
            ))}
          </Table>
          <Paragraphs n={5} from={1} size={10} />
          <ColumnBreak />
          <Text size={11} bold color="#1450aa">
            Notes
          </Text>
          <Paragraphs n={6} from={2} size={8} />
        </Flow>
        <Text size={10} italic>
          End of report.
        </Text>
      </Page>
    </Document>
  );
}

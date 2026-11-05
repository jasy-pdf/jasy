import {
  Divider,
  Document,
  Page,
  PageCount,
  PageNumber,
  Row,
  Table,
  TableCell,
  TableRow,
  Text,
} from "@jasy/react";

const CATALOG = [
  { desc: "Design work - landing page", price: 1200 },
  { desc: "Frontend development (React)", price: 3400 },
  { desc: "PDF engine integration", price: 800 },
  { desc: "Accessibility review", price: 650 },
  { desc: "Hosting, 12 months", price: 240 },
];
const eur = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });

export default function Invoice({ customer, lines }: { customer: string; lines: number }) {
  const items = Array.from({ length: lines }, (_, i) => CATALOG[i % CATALOG.length]);
  const total = items.reduce((sum, item) => sum + item.price, 0);

  return (
    <Document size={11} color="#1f2937">
      <Page
        size="A4"
        gap={16}
        footer={
          <Row justify="between">
            <Text size={9} color="#94a3b8">
              Acme GmbH · Musterstrasse 1 · 10115 Berlin
            </Text>
            <Row gap={3}>
              <Text size={9} color="#94a3b8">
                Page
              </Text>
              <PageNumber size={9} color="#94a3b8" />
              <Text size={9} color="#94a3b8">
                of
              </Text>
              <PageCount size={9} color="#94a3b8" />
            </Row>
          </Row>
        }
      >
        <Row justify="between">
          <Text size={22} bold color="#0a2348">
            Acme GmbH
          </Text>
          <Text size={22} bold color="#1450aa">
            INVOICE
          </Text>
        </Row>
        <Text color="#64748b">No. 2026-0042 · 2026-06-24 · due in 14 days</Text>
        <Text size={12}>Bill to: {customer}</Text>

        {/* The header row repeats at the top of every page the table flows onto. */}
        <Table columns={[36, "1fr", 110]} cellBorder="#e2e8f0" cellPadding={8}>
          <TableRow header>
            <TableCell>
              <Text bold color="#0a2348">
                #
              </Text>
            </TableCell>
            <TableCell>
              <Text bold color="#0a2348">
                Description
              </Text>
            </TableCell>
            <TableCell>
              <Text bold color="#0a2348" align="right">
                Amount (EUR)
              </Text>
            </TableCell>
          </TableRow>
          {items.map((item, i) => (
            <TableRow key={i}>
              <TableCell>{String(i + 1)}</TableCell>
              <TableCell>{item.desc}</TableCell>
              <TableCell>
                <Text align="right">{eur(item.price)}</Text>
              </TableCell>
            </TableRow>
          ))}
        </Table>

        <Divider />
        <Row justify="between" keepTogether>
          <Text size={14} bold>
            Total
          </Text>
          <Text size={14} bold color="#1450aa">
            {eur(total)} EUR
          </Text>
        </Row>
        <Text size={10} color="#94a3b8">
          Thank you for your business. Payment within 14 days.
        </Text>
      </Page>
    </Document>
  );
}

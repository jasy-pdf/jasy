<script setup lang="ts">
import { computed } from "vue";
import {
  Document,
  Page,
  Row,
  Text,
  Divider,
  Table,
  TableRow,
  TableCell,
  PageNumber,
  PageCount,
} from "@jasy/vue";

const props = defineProps<{ customer: string; lines: number }>();

const CATALOG = [
  { desc: "Design work - landing page", price: 1200 },
  { desc: "Frontend development (Vue)", price: 3400 },
  { desc: "PDF engine integration", price: 800 },
  { desc: "Accessibility review", price: 650 },
  { desc: "Hosting, 12 months", price: 240 },
];
const eur = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2 });
const items = computed(() =>
  Array.from({ length: props.lines }, (_, i) => CATALOG[i % CATALOG.length]),
);
const total = computed(() => items.value.reduce((sum, item) => sum + item.price, 0));
</script>

<template>
  <Document :size="11" color="#1f2937">
    <Page size="A4" :gap="16">
      <Row justify="between">
        <Text :size="22" bold color="#0a2348">Acme GmbH</Text>
        <Text :size="22" bold color="#1450aa">INVOICE</Text>
      </Row>
      <Text color="#64748b">No. 2026-0042 · 2026-06-24 · due in 14 days</Text>
      <Text :size="12">Bill to: {{ customer }}</Text>

      <!-- The header row repeats at the top of every page the table flows onto. -->
      <Table :columns="[36, '1fr', 110]" cell-border="#e2e8f0" :cell-padding="8">
        <TableRow header>
          <TableCell><Text bold color="#0a2348">#</Text></TableCell>
          <TableCell><Text bold color="#0a2348">Description</Text></TableCell>
          <TableCell><Text bold color="#0a2348" align="right">Amount (EUR)</Text></TableCell>
        </TableRow>
        <TableRow v-for="(item, i) in items" :key="i">
          <TableCell>{{ i + 1 }}</TableCell>
          <TableCell>{{ item.desc }}</TableCell>
          <TableCell
            ><Text align="right">{{ eur(item.price) }}</Text></TableCell
          >
        </TableRow>
      </Table>

      <Divider />
      <Row justify="between" keep-together>
        <Text :size="14" bold>Total</Text>
        <Text :size="14" bold color="#1450aa">{{ eur(total) }} EUR</Text>
      </Row>
      <Text :size="10" color="#94a3b8">Thank you for your business. Payment within 14 days.</Text>

      <template #footer>
        <Row justify="between">
          <Text :size="9" color="#94a3b8">Acme GmbH · Musterstrasse 1 · 10115 Berlin</Text>
          <Row :gap="3">
            <Text :size="9" color="#94a3b8">Page</Text>
            <PageNumber :size="9" color="#94a3b8" />
            <Text :size="9" color="#94a3b8">of</Text>
            <PageCount :size="9" color="#94a3b8" />
          </Row>
        </Row>
      </template>
    </Page>
  </Document>
</template>

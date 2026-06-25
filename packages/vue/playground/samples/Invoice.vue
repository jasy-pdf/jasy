<script setup lang="ts">
import { Document, Page, Row, Text, Divider, Table, TableRow, TableCell } from "@jasy/vue";

// Real Vue: the line items are data, rendered with v-for.
const items = [
  { desc: "Design work - landing page", amount: "1,200.00" },
  { desc: "Frontend development (Vue)", amount: "3,400.00" },
  { desc: "PDF engine integration", amount: "800.00" },
];
</script>

<template>
  <Document>
    <Page :size="'A4'" :gap="16">
      <Row :justify="'between'">
        <Text :size="22" bold :color="'#0a2348'">Acme GmbH</Text>
        <Text :size="22" bold :color="'#1450aa'">INVOICE</Text>
      </Row>

      <Text :size="11" :color="'#64748b'">No. 2026-0042 · 2026-06-24 · due in 14 days</Text>
      <Text :size="12">Bill to: Max Mustermann, Musterstrasse 1, 12345 Berlin</Text>

      <Table :columns="['1fr', 120]" cell-border="#e2e8f0" :cell-padding="9">
        <TableRow header>
          <TableCell><Text :size="11" bold :color="'#0a2348'">Description</Text></TableCell>
          <TableCell
            ><Text :size="11" bold :color="'#0a2348'" align="right">Amount (EUR)</Text></TableCell
          >
        </TableRow>
        <TableRow v-for="item in items" :key="item.desc">
          <TableCell>{{ item.desc }}</TableCell>
          <TableCell
            ><Text align="right">{{ item.amount }}</Text></TableCell
          >
        </TableRow>
      </Table>

      <Divider />

      <Row :justify="'between'">
        <Text :size="14" bold>Total</Text>
        <Text :size="14" bold :color="'#1450aa'">5,400.00 EUR</Text>
      </Row>

      <Text :size="10" :color="'#94a3b8'"
        >Thank you for your business. Payment within 14 days.</Text
      >
    </Page>
  </Document>
</template>

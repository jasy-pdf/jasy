<script setup lang="ts">
import { Document, Page, Column, Row, Box, Text, Divider } from "@jasy/vue";

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
      <Text :size="11" :color="'#64748b'">No. 2026-0042  ·  2026-06-24  ·  due in 14 days</Text>
      <Text :size="12">Bill to: Max Mustermann, Musterstrasse 1, 12345 Berlin</Text>

      <Box :bg="'#0a2348'" :padding="10" :radius="4">
        <Row :justify="'between'">
          <Text :size="11" bold :color="'#ffffff'">Description</Text>
          <Text :size="11" bold :color="'#ffffff'">Amount (EUR)</Text>
        </Row>
      </Box>

      <Column :gap="8">
        <Row v-for="item in items" :key="item.desc" :justify="'between'">
          <Text :size="12">{{ item.desc }}</Text>
          <Text :size="12">{{ item.amount }}</Text>
        </Row>
      </Column>

      <Divider />

      <Row :justify="'between'">
        <Text :size="14" bold>Total</Text>
        <Text :size="14" bold :color="'#1450aa'">5,400.00 EUR</Text>
      </Row>

      <Text :size="10" :color="'#94a3b8'">Thank you for your business. Payment within 14 days.</Text>
    </Page>
  </Document>
</template>

<script setup lang="ts">
import { JasyDocument, JasyPage, JasyColumn, JasyRow, JasyBox, JasyText, JasyDivider } from "@jasy/vue";

// Real Vue: the line items are data, rendered with v-for.
const items = [
  { desc: "Design work - landing page", amount: "1,200.00" },
  { desc: "Frontend development (Vue)", amount: "3,400.00" },
  { desc: "PDF engine integration", amount: "800.00" },
];
</script>

<template>
  <JasyDocument>
    <JasyPage :size="'A4'" :gap="16">
      <JasyRow :justify="'between'">
        <JasyText :size="22" :bold="true" :color="'#0a2348'">Acme GmbH</JasyText>
        <JasyText :size="22" :bold="true" :color="'#1450aa'">INVOICE</JasyText>
      </JasyRow>
      <JasyText :size="11" :color="'#64748b'">No. 2026-0042  ·  2026-06-24  ·  due in 14 days</JasyText>
      <JasyText :size="12">Bill to: Max Mustermann, Musterstrasse 1, 12345 Berlin</JasyText>

      <JasyBox :bg="'#0a2348'" :padding="10" :radius="4">
        <JasyRow :justify="'between'">
          <JasyText :size="11" :bold="true" :color="'#ffffff'">Description</JasyText>
          <JasyText :size="11" :bold="true" :color="'#ffffff'">Amount (EUR)</JasyText>
        </JasyRow>
      </JasyBox>

      <JasyColumn :gap="8">
        <JasyRow v-for="item in items" :key="item.desc" :justify="'between'">
          <JasyText :size="12">{{ item.desc }}</JasyText>
          <JasyText :size="12">{{ item.amount }}</JasyText>
        </JasyRow>
      </JasyColumn>

      <JasyDivider />

      <JasyRow :justify="'between'">
        <JasyText :size="14" :bold="true">Total</JasyText>
        <JasyText :size="14" :bold="true" :color="'#1450aa'">5,400.00 EUR</JasyText>
      </JasyRow>

      <JasyText :size="10" :color="'#94a3b8'">Thank you for your business. Payment within 14 days.</JasyText>
    </JasyPage>
  </JasyDocument>
</template>

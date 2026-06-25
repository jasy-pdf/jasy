<script setup lang="ts">
import { computed } from "vue";
import {
  Document,
  Page,
  Column,
  Row,
  Box,
  Text,
  Image,
  Divider,
} from "@jasy/vue";

// font + image arrive as raw bytes (App.vue fetched them in the browser) - no filesystem, no server.
const props = defineProps<{ font: Uint8Array; image: Uint8Array }>();

// Real Vue: data + computed values that land straight in the PDF.
const products = [
  { name: "Origami Crane Kit", qty: 3, price: 12.5 },
  { name: "Washi Tape Set", qty: 2, price: 8.0 },
  { name: "Calligraphy Pen", qty: 1, price: 24.9 },
];
const rows = computed(() => products.map((p) => ({ ...p, total: (p.qty * p.price).toFixed(2) })));
const grandTotal = computed(() => products.reduce((s, p) => s + p.qty * p.price, 0).toFixed(2));
</script>

<template>
  <!-- :fonts registers the custom .ttf under a name; :font on a Text then selects it. -->
  <Document :fonts="{ GreatVibes: props.font }">
    <Page :size="'A4'" :gap="14">
      <Row :justify="'between'" :align="'center'">
        <Text :font="'GreatVibes'" :size="44" :color="'#1450aa'">Jasy Atelier</Text>
        <Image :src="props.image" :width="84" :height="84" :fit="'cover'" :radius="42" />
      </Row>
      <Text :size="11" :color="'#64748b'"
        >Custom .ttf &middot; image bytes &middot; v-for &middot; computed totals &mdash; rendered 100% in your
        browser</Text
      >
      <Divider />

      <Box :bg="'#0a2348'" :padding="10" :radius="4">
        <Row :justify="'between'">
          <Text :size="11" :bold="true" :color="'#ffffff'">Product</Text>
          <Text :size="11" :bold="true" :color="'#ffffff'">Qty &times; Price = Total</Text>
        </Row>
      </Box>

      <Column :gap="7">
        <Row v-for="r in rows" :key="r.name" :justify="'between'">
          <Text :size="12">{{ r.name }}</Text>
          <Text :size="12">{{ r.qty }} &times; {{ r.price.toFixed(2) }} = {{ r.total }} &euro;</Text>
        </Row>
      </Column>

      <Divider />
      <Row :justify="'between'">
        <Text :size="14" :bold="true">Total</Text>
        <Text :font="'GreatVibes'" :size="22" :color="'#1450aa'">{{ grandTotal }} &euro;</Text>
      </Row>
    </Page>
  </Document>
</template>

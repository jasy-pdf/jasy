<script setup lang="ts">
import { computed } from "vue";
import {
  JasyDocument,
  JasyPage,
  JasyColumn,
  JasyRow,
  JasyBox,
  JasyText,
  JasyImage,
  JasyDivider,
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
  <JasyDocument :fonts="{ GreatVibes: props.font }">
    <JasyPage :size="'A4'" :gap="14">
      <JasyRow :justify="'between'" :align="'center'">
        <JasyText :font="'GreatVibes'" :size="44" :color="'#1450aa'">Jasy Atelier</JasyText>
        <JasyImage :src="props.image" :width="84" :height="84" :fit="'cover'" :radius="42" />
      </JasyRow>
      <JasyText :size="11" :color="'#64748b'"
        >Custom .ttf &middot; image bytes &middot; v-for &middot; computed totals &mdash; rendered 100% in your
        browser</JasyText
      >
      <JasyDivider />

      <JasyBox :bg="'#0a2348'" :padding="10" :radius="4">
        <JasyRow :justify="'between'">
          <JasyText :size="11" :bold="true" :color="'#ffffff'">Product</JasyText>
          <JasyText :size="11" :bold="true" :color="'#ffffff'">Qty &times; Price = Total</JasyText>
        </JasyRow>
      </JasyBox>

      <JasyColumn :gap="7">
        <JasyRow v-for="r in rows" :key="r.name" :justify="'between'">
          <JasyText :size="12">{{ r.name }}</JasyText>
          <JasyText :size="12">{{ r.qty }} &times; {{ r.price.toFixed(2) }} = {{ r.total }} &euro;</JasyText>
        </JasyRow>
      </JasyColumn>

      <JasyDivider />
      <JasyRow :justify="'between'">
        <JasyText :size="14" :bold="true">Total</JasyText>
        <JasyText :font="'GreatVibes'" :size="22" :color="'#1450aa'">{{ grandTotal }} &euro;</JasyText>
      </JasyRow>
    </JasyPage>
  </JasyDocument>
</template>

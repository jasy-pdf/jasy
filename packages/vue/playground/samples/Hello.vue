<script setup lang="ts">
// Namespace import - sidesteps a UI lib's own Row/Text/Box without per-name aliasing.
import * as Pdf from "@jasy/vue";

defineProps<{ name: string }>();
</script>

<template>
  <Pdf.Document>
    <Pdf.Page size="A4" :gap="14">
      <Pdf.Text :size="30" bold color="#1450aa">Hello, {{ name }}</Pdf.Text>
      <Pdf.Text :size="13" color="#475569"
        >This whole document is a Vue component tree, rendered to a real PDF by @jasy/vue - right
        here in your browser. Change the name, or edit this file and watch it rebuild.</Pdf.Text
      >
      <Pdf.Box bg="#eef2ff" :padding="16" :radius="6">
        <Pdf.Text :size="12"
          >A Box with a background, padding and rounded corners, holding a Text.</Pdf.Text
        >
      </Pdf.Box>
    </Pdf.Page>
  </Pdf.Document>
</template>

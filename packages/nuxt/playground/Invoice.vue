<script setup lang="ts">
// A PDF component - uses the auto-registered jasy components, no imports. Rendered in the browser.
const title = ref("Rendered on the client");
</script>

<template>
  <Document :size="11" color="#1f2937">
    <Page :size="'A4'" :margin="56" :gap="14">
      <Text :size="26" bold color="#0a2348">{{ title }}</Text>
      <Text color="#64748b"
        >Built in your browser from a Vue component - no server round-trip.</Text
      >
      <Box bg="#0a2348" :padding="12" :radius="6">
        <Text color="#f3dc29" bold>@jasy/nuxt - client-side</Text>
      </Box>
    </Page>
  </Document>
</template>

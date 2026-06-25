<script setup lang="ts">
import { Document, Page, Row, Box, Text, Image } from "@jasy/vue";

// The logo is a PNG with a transparent background. It is decoded in the browser (OffscreenCanvas) and
// embedded with a real /SMask alpha channel, so on a colored panel the panel shows through the
// transparent areas - not a white rectangle.
const props = defineProps<{ logo: Uint8Array }>();

const panels = ["#0a2348", "#0d9488", "#fb7185"];
</script>

<template>
  <Document :size="12" color="#1f2937">
    <Page :size="'A4'" :gap="20">
      <Text :size="22" bold color="#0a2348">Transparent PNG</Text>
      <Text color="#64748b"
        >A PNG with an alpha channel - decoded client-side and embedded with a real /SMask. The
        transparency composites over whatever sits behind it.</Text
      >

      <Row :gap="16" :align="'center'">
        <Box v-for="bg in panels" :key="bg" :bg="bg" :padding="16" :radius="8">
          <Image :src="props.logo" :width="100" :height="100" :fit="'contain'" />
        </Box>
      </Row>

      <Text :size="10" color="#94a3b8"
        >The same logo on three colored panels - each shows the panel through the transparent areas, not
        a white box. Composite-over-white would put an opaque rectangle behind every crane.</Text
      >
    </Page>
  </Document>
</template>

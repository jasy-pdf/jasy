<script setup lang="ts">
// Namespace import - sidesteps a UI lib's own Row/Text/Box without per-name aliasing.
import * as Pdf from "@jasy/vue";
</script>

<template>
  <Pdf.Document>
    <Pdf.Page :size="'A4'" :gap="16">
      <Pdf.Text :size="28" bold :color="'#0a2348'">Confidential</Pdf.Text>
      <Pdf.Text :size="13" :color="'#475569'"
        >This document is encrypted with AES-256. A PDF viewer asks for the password before it shows
        anything - and it was rendered 100% in your browser by @jasy/vue.</Pdf.Text
      >
      <Pdf.Box :bg="'#fef3c7'" :padding="16">
        <Pdf.Text :size="12" :color="'#92400e'"
          >Salary review, Q3 projections, and other things you would not send in plain text.</Pdf.Text
        >
      </Pdf.Box>
      <Pdf.Text :size="11" :color="'#94a3b8'">JasyPDF - no Java, no headless browser.</Pdf.Text>
    </Pdf.Page>
  </Pdf.Document>
</template>

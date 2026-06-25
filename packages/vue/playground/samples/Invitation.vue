<script setup lang="ts">
import { Document, Page, Column, Box, Text, Expanded, Divider } from "@jasy/vue";
</script>

<template>
  <Document>
    <Page :size="'A5'" :margin="0">
      <!-- Expanded fills the whole page height; the Box (full width by default) makes it full-bleed. -->
      <Expanded>
        <Box :bg="'#0a2348'" :padding="44">
          <Column :gap="14" :align="'center'">
            <Text :size="12" bold :color="'#f3dc29'" :align="'center'">YOU ARE INVITED</Text>
            <Text :size="34" bold :color="'#ffffff'" :align="'center'">Summer Gala 2026</Text>
            <Text :size="12" :color="'#9db8e0'" :align="'center'">An evening of music, food and celebration.</Text>
            <Divider />
            <Text :size="12" :color="'#ffffff'" :align="'center'">Saturday, 12 July 2026  ·  19:00</Text>
            <Text :size="12" :color="'#ffffff'" :align="'center'">The Old Warehouse, Berlin</Text>
          </Column>
        </Box>
      </Expanded>
    </Page>
  </Document>
</template>

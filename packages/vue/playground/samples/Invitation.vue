<script setup lang="ts">
import { JasyDocument, JasyPage, JasyColumn, JasyBox, JasyText, JasyExpanded, JasyDivider } from "@jasy/vue";
</script>

<template>
  <JasyDocument>
    <JasyPage :size="'A5'" :margin="0">
      <!-- Expanded fills the whole page height; the Box (full width by default) makes it full-bleed. -->
      <JasyExpanded>
        <JasyBox :bg="'#0a2348'" :padding="44">
          <JasyColumn :gap="14" :align="'center'">
            <JasyText :size="12" :bold="true" :color="'#f3dc29'" :align="'center'">YOU ARE INVITED</JasyText>
            <JasyText :size="34" :bold="true" :color="'#ffffff'" :align="'center'">Summer Gala 2026</JasyText>
            <JasyText :size="12" :color="'#9db8e0'" :align="'center'">An evening of music, food and celebration.</JasyText>
            <JasyDivider />
            <JasyText :size="12" :color="'#ffffff'" :align="'center'">Saturday, 12 July 2026  ·  19:00</JasyText>
            <JasyText :size="12" :color="'#ffffff'" :align="'center'">The Old Warehouse, Berlin</JasyText>
          </JasyColumn>
        </JasyBox>
      </JasyExpanded>
    </JasyPage>
  </JasyDocument>
</template>

<script setup lang="ts">
import { JasyDocument, JasyPage, JasyBox, JasyText } from "@jasy/vue";
</script>

<template>
  <JasyDocument>
    <JasyPage :size="'A4'" :gap="14">
      <JasyText :size="30" :bold="true" :color="'#1450aa'">Hello from a .vue file</JasyText>
      <JasyText :size="13" :color="'#475569'">This whole document is a Vue component tree, rendered to a real PDF by @jasy/vue. Edit the template and watch it rebuild.</JasyText>
      <JasyBox :bg="'#eef2ff'" :padding="16">
        <JasyText :size="12">A Box with a background and padding, holding its own Text.</JasyText>
      </JasyBox>
    </JasyPage>
  </JasyDocument>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  Document,
  Page,
  Row,
  Column,
  Box,
  Text,
  Positioned,
  Padding,
  PageBuilder,
} from "@jasy/vue";

const props = defineProps<{ sections: number }>();

const TOPICS = [
  {
    h: "Executive summary",
    p: "Revenue grew 18% quarter over quarter, driven by the new self-serve tier. Churn held steady at 2.1%, and gross margin improved by three points after the infrastructure migration.",
  },
  {
    h: "Acquisition",
    p: "Organic signups outpaced paid for the first time. The documentation rewrite and the in-browser playground are the two largest referrers, together accounting for 41% of new accounts.",
  },
  {
    h: "Activation",
    p: "Time-to-first-render dropped from 9 minutes to under 2 after the quick-start template shipped. Teams that render a document in week one retain at nearly double the rate of those that do not.",
  },
  {
    h: "Retention",
    p: "Cohort curves flattened earlier than in any prior quarter. The invoice and report templates are the stickiest surfaces; accounts that adopt them rarely lapse.",
  },
  {
    h: "Infrastructure",
    p: "The move to fully client-side rendering removed an entire service tier. Median render latency is now bound only by the client, and the egress bill fell accordingly.",
  },
  {
    h: "Risks",
    p: "Single-format dependence remains the chief risk. Broadening the e-invoice profile coverage and shipping the framework bindings are the two mitigations on deck.",
  },
  {
    h: "Outlook",
    p: "We expect the framework bindings to compound the acquisition gains. Conservative guidance holds the current growth rate; the upside case assumes the Nuxt module lands on schedule.",
  },
];
// As many sections as the slider asks for - the header and footer repeat on every page they flow onto.
const shown = computed(() =>
  Array.from({ length: props.sections }, (_, i) => ({ n: i + 1, ...TOPICS[i % TOPICS.length] })),
);
</script>

<template>
  <Document :size="11" color="#1f2937" :lineHeight="1.4">
    <Page :size="'A4'" :gap="13">
      <template #header>
        <Row :justify="'between'">
          <Text :size="12" bold color="#0a2348">ACME Analytics</Text>
          <PageBuilder #default="{ pageNumber, pageCount }">
            <Text :size="12" color="#64748b">{{
              pageNumber === 1
                ? "Quarterly Report · Q2 2026"
                : `continued · page ${pageNumber} of ${pageCount}`
            }}</Text>
          </PageBuilder>
        </Row>
      </template>
      <template #footer>
        <Text :size="9" color="#94a3b8" align="center"
          >Confidential &middot; &copy; ACME GmbH &middot; repeats on every page</Text
        >
      </template>

      <Padding :insets="[15, 0, 0, 0]">
        <Box relative bg="#eef2ff" :padding="16" :radius="6">
          <Text :size="20" bold color="#0a2348">Performance Review</Text>
          <Positioned :top="-10" :right="-10">
            <Box bg="#1450aa" :padding="6" :radius="12"
              ><Text :size="9" bold color="#ffffff">DRAFT</Text></Box
            >
          </Positioned>
        </Box>
      </Padding>

      <Column v-for="s in shown" :key="s.n" :gap="3" keep-together>
        <Text :size="13" bold color="#0a2348" role="h2">{{ s.n }}. {{ s.h }}</Text>
        <Text align="justify">{{ s.p }}</Text>
      </Column>
    </Page>
  </Document>
</template>

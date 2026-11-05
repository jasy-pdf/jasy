<script setup lang="ts">
// Namespace import - sidesteps a UI lib's own Row/Text/Box without per-name aliasing.
import * as Pdf from "@jasy/vue";
import { computed } from "vue";

// The values come from props: change the name and the fields IN THE GENERATED PDF change with it.
const props = defineProps<{ name: string }>();

// Options come from data, in the short spelling where the stored value IS the visible text ...
const sizes = ["S", "M", "L"];
// ... and in the explicit one where they differ: the PDF stores "EUR", the reader sees "Euro".
const currencies = [
  { value: "EUR", label: "Euro" },
  { value: "CHF", label: "Swiss franc" },
  { value: "GBP", label: "Pound sterling" },
];

const label = computed(() => `I agree to the terms, ${props.name.split(" ")[0]}`);
</script>

<template>
  <Pdf.Document :size="11">
    <Pdf.Page :size="'A4'" :margin="48" :gap="6">
      <Pdf.Text :size="24" bold :color="'#0a2348'">Membership form</Pdf.Text>
      <Pdf.Text :size="11" :color="'#475569'"
        >Every field below is a real AcroForm widget. Open the PDF in any viewer and type into
        it.</Pdf.Text
      >

      <Pdf.Text :size="9" :color="'#64748b'">Full name</Pdf.Text>
      <Pdf.TextField name="full_name" :value="name" :height="24" border="#94a3b8" />

      <Pdf.Text :size="9" :color="'#64748b'">Notes (multiline)</Pdf.Text>
      <Pdf.TextField name="notes" value="jasy is great!" multiline :height="52" border="#94a3b8" />

      <!-- The label is the default slot: no Row to assemble by hand. -->
      <Pdf.Checkbox name="agree" checked :size="14">{{ label }}</Pdf.Checkbox>

      <Pdf.Text :size="9" :color="'#64748b'">Plan</Pdf.Text>
      <Pdf.RadioGroup name="plan" value="pro" :size="14" :options="['basic', 'pro']" />

      <Pdf.Text :size="9" :color="'#64748b'">Size - options as plain strings</Pdf.Text>
      <Pdf.ListBox
        name="size"
        value="M"
        :width="200"
        :height="56"
        border="#94a3b8"
        :options="sizes"
      />

      <Pdf.Text :size="9" :color="'#64748b'">Currency - value and label differ</Pdf.Text>
      <Pdf.Dropdown
        name="currency"
        value="EUR"
        :width="200"
        :height="21"
        border="#94a3b8"
        :options="currencies"
      />

      <Pdf.Row :gap="12">
        <Pdf.PushButton name="submit" :width="120" :height="26">Submit</Pdf.PushButton>
        <Pdf.PushButton name="reset" :width="120" :height="26" :action="'reset'"
          >Reset</Pdf.PushButton
        >
      </Pdf.Row>

      <Pdf.Text :size="9" :color="'#64748b'">Signature</Pdf.Text>
      <Pdf.SignatureField name="sig" :width="240" :height="46">Sign here</Pdf.SignatureField>

      <Pdf.Spacer />
      <Pdf.Text :size="10" :color="'#94a3b8'"
        >Rendered 100% in your browser by @jasy/vue - no Java, no headless browser.</Pdf.Text
      >
    </Pdf.Page>
  </Pdf.Document>
</template>

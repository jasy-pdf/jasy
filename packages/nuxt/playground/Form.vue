<script setup lang="ts">
// No imports at all: @jasy/nuxt auto-registers the form components alongside Document/Page/Text.
// The values come from ordinary reactive state, so the PDF is built from whatever the app knows.
const holder = ref("Ada Lovelace");
const notes = ref("jasyPDF is also great with Nuxt!");
const currencies = [
  { value: "EUR", label: "Euro" },
  { value: "CHF", label: "Swiss franc" },
];
</script>

<template>
  <Document :size="11">
    <Page size="A4" :margin="48" :gap="6">
      <Text :size="24" bold color="#0a2348">Membership form</Text>
      <Text :size="11" color="#475569">
        Rendered in your browser. Every field below is a real AcroForm widget - type into it.
      </Text>

      <Text :size="9" color="#64748b">Full name</Text>
      <TextField name="full_name" :value="holder" :height="24" border="#94a3b8" />

      <Text :size="9" color="#64748b">Notes (multiline)</Text>
      <TextField name="notes" :value="notes" multiline :height="52" border="#94a3b8" />

      <!-- The label is the default slot - no Row to assemble by hand. -->
      <Checkbox name="agree" checked :size="14">I agree to the terms</Checkbox>

      <Text :size="9" color="#64748b">Plan</Text>
      <RadioGroup name="plan" value="pro" :size="14" :options="['basic', 'pro']" />

      <Text :size="9" color="#64748b">Currency - stored value and shown label differ</Text>
      <Dropdown
        name="currency"
        value="EUR"
        :width="200"
        :height="21"
        border="#94a3b8"
        :options="currencies"
      />

      <Text :size="9" color="#64748b">Size</Text>
      <ListBox
        name="size"
        value="M"
        :width="200"
        :height="56"
        border="#94a3b8"
        :options="['S', 'M', 'L']"
      />

      <Row :gap="12">
        <PushButton name="submit" :width="120" :height="26">Submit</PushButton>
        <PushButton name="reset" action="reset" :width="120" :height="26">Reset</PushButton>
      </Row>

      <Text :size="9" color="#64748b">Signature</Text>
      <SignatureField name="sig" :width="240" :height="46">Sign here</SignatureField>
    </Page>
  </Document>
</template>

import {
  Checkbox,
  Document,
  Dropdown,
  ListBox,
  Page,
  PushButton,
  RadioGroup,
  Row,
  SignatureField,
  Spacer,
  Text,
  TextField,
} from "@jasy/react";

const CURRENCIES = [
  { value: "EUR", label: "Euro" },
  { value: "CHF", label: "Swiss franc" },
  { value: "GBP", label: "Pound sterling" },
];

const Label = ({ children }: { children: string }) => (
  <Text size={9} color="#64748b">
    {children}
  </Text>
);

// Every field is a real AcroForm widget: open the PDF and type into it. The values come from props.
export default function Form({ name }: { name: string }) {
  return (
    <Document size={11}>
      <Page size="A4" margin={48} gap={6}>
        <Text size={24} bold color="#0a2348">
          Membership form
        </Text>
        <Text color="#475569">Every field below is a real form field. Click into it and type.</Text>

        <Label>Full name</Label>
        <TextField name="full_name" value={name} height={24} border="#94a3b8" />

        <Label>Notes (multiline)</Label>
        <TextField name="notes" value="jasy is great!" multiline height={52} border="#94a3b8" />

        {/* The children are the label - no Row to assemble by hand. */}
        <Checkbox name="agree" checked size={14}>
          I agree to the terms, {name.split(" ")[0]}
        </Checkbox>

        <Label>Plan</Label>
        <RadioGroup name="plan" value="pro" size={14} options={["basic", "pro"]} />

        <Label>Size - options as plain strings</Label>
        <ListBox
          name="size"
          value="M"
          width={200}
          height={56}
          border="#94a3b8"
          options={["S", "M", "L"]}
        />

        <Label>Currency - value and label differ</Label>
        <Dropdown
          name="currency"
          value="EUR"
          width={200}
          height={21}
          border="#94a3b8"
          options={CURRENCIES}
        />

        <Row gap={12}>
          <PushButton name="submit" width={120} height={26}>
            Submit
          </PushButton>
          <PushButton name="reset" width={120} height={26} action="reset">
            Reset
          </PushButton>
        </Row>

        <Label>Signature</Label>
        <SignatureField name="sig" width={240} height={46}>
          Sign here
        </SignatureField>

        <Spacer />
        <Text size={10} color="#94a3b8">
          Rendered in your browser by @jasy/react - no Java, no headless browser.
        </Text>
      </Page>
    </Document>
  );
}

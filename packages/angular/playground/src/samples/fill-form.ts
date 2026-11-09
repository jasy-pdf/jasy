import type { FormValues } from "@jasy/angular";

// An existing PDF with form fields - any AcroForm PDF works, from any tool. jasy reads its fields
// and fills them by name: filledPdfResource(MEMBERSHIP_FORM, () => membershipFields(values)).
export const MEMBERSHIP_FORM = "forms/membership.pdf";

export const membershipFields = (v: { name: string; notes: string; plan: string }): FormValues => ({
  full_name: v.name,
  notes: v.notes,
  agree: v.name.trim() !== "",
  // A radio group takes one of its own values; anything else is refused by name.
  plan: v.plan,
});

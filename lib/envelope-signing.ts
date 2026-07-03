// Server-side validation for the native e-sign completion path
// (app/api/sign/[token]/complete). Pure so it's directly testable.

export interface EnvelopeFieldRequirement {
  id: string
  field_type: 'signature' | 'initials' | 'text' | 'date' | 'checkbox'
  label: string | null
  required: boolean
}

// A required checkbox only counts when the response is an affirmative checked
// value — generic non-empty-string truthiness would let "false" satisfy it.
const CHECKED_VALUES = new Set(['true', 'checked', 'on', '1'])

/**
 * Every required field must be satisfied before a signature is accepted —
 * previously the completion handler never read envelope_fields at all, so an
 * envelope whose fields were marked required could be completed with all of
 * them blank. signature/initials field types are satisfied by the submitted
 * signature/initials images; a checkbox needs an affirmative checked value;
 * the rest need a non-empty response for that field id. Returns the labels
 * of whatever is missing (empty = all satisfied).
 */
export function missingRequiredFields(
  fields: EnvelopeFieldRequirement[],
  args: {
    signatureData: string
    initialsData: string | null
    fieldResponses: Record<string, string>
  },
): string[] {
  const missing: string[] = []
  for (const field of fields) {
    if (!field.required) continue
    const satisfied =
      field.field_type === 'signature'
        ? Boolean(args.signatureData)
        : field.field_type === 'initials'
          ? Boolean(args.initialsData)
          : field.field_type === 'checkbox'
            ? CHECKED_VALUES.has(args.fieldResponses[field.id]?.trim().toLowerCase() ?? '')
            : Boolean(args.fieldResponses[field.id]?.trim())
    if (!satisfied) missing.push(field.label || field.field_type)
  }
  return missing
}

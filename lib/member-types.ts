/**
 * Member types for the Proof of Truth profile. User-level (distinct from the
 * org-level `org_type` enum). Kept in sync with the `profiles.member_type`
 * check constraint — update both together.
 */
export const MEMBER_TYPES = [
  'investment_firm',
  'service_provider',
  'startup',
  'student',
  'individual_investor'
] as const;

export type MemberType = (typeof MEMBER_TYPES)[number];

/** Human-readable labels for the member types. */
export const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
  investment_firm: 'Investment firm',
  service_provider: 'Service provider',
  startup: 'Startup',
  student: 'Student',
  individual_investor: 'Individual investor'
};

/** One-line descriptions used in the member-type picker. */
export const MEMBER_TYPE_BLURBS: Record<MemberType, string> = {
  investment_firm: 'Funds, family offices, and institutional allocators deploying capital.',
  service_provider: 'Advisors, agencies, and firms serving the private markets.',
  startup: 'Founders and companies raising or scaling.',
  student: 'Students and early-career operators building toward the industry.',
  individual_investor: 'Angels and individual LPs investing personal capital.'
};

export function isMemberType(value: unknown): value is MemberType {
  return typeof value === 'string' && (MEMBER_TYPES as readonly string[]).includes(value);
}

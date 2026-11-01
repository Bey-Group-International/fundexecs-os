// Security audit events for MFA (pure). The detail is a short allow-listed set of
// scalar fields — never a code, secret, QR payload or free text — so the log can
// be shown to an auditor without redaction.
export const MFA_AUDIT_ACTIONS = [
  "mfa.enroll_started",
  "mfa.enrolled",
  "mfa.challenge_ok",
  "mfa.challenge_failed",
  "mfa.factor_removed",
  "mfa.recovery_codes_generated",
  "mfa.recovery_used",
  "mfa.recovery_failed",
  "mfa.recovery_locked",
] as const;
export type MfaAuditAction = (typeof MFA_AUDIT_ACTIONS)[number];

const DETAIL_KEYS = ["factor_type", "codes", "factors_removed", "reason"] as const;

export interface MfaAuditEvent {
  userId: string;
  organizationId?: string | null;
  action: MfaAuditAction;
  detail?: Partial<Record<(typeof DETAIL_KEYS)[number], string | number | boolean>>;
}

export function mfaAuditRow(e: MfaAuditEvent) {
  if (!e.userId || !MFA_AUDIT_ACTIONS.includes(e.action)) return null;
  const detail: Record<string, string | number | boolean> = {};
  for (const k of DETAIL_KEYS) {
    const v = e.detail?.[k];
    if (typeof v === "number" || typeof v === "boolean") detail[k] = v;
    else if (typeof v === "string") detail[k] = v.slice(0, 64);
  }
  return { user_id: e.userId, organization_id: e.organizationId ?? null, action: e.action, detail };
}

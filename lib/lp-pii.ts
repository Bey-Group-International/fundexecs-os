// Which LP onboarding columns are encrypted, and how. One place, so a column is
// never sealed on write but forgotten on read (or the reverse).
//
// Only fields that are DISPLAYED, never searched, screened or joined on are
// sealed. Names (legal, signatory, owners) are left readable because the OFAC
// screen and the review list work from them.
import { decryptFieldSafe, encryptField } from "@/lib/crypto/field-encryption";

export const LP_PROFILE_SEALED_COLUMNS = ["contact_phone", "source_of_funds"] as const;
type SealedColumn = (typeof LP_PROFILE_SEALED_COLUMNS)[number];

function aad(sessionId: string, column: string): string {
  return `lp_onboarding_profiles.${column}:${sessionId}`;
}

/** Encrypt the sealed columns present in a profile write. Other keys are untouched. */
export function sealProfileWrite<T extends Partial<Record<SealedColumn, string | null>>>(sessionId: string, row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const col of LP_PROFILE_SEALED_COLUMNS) {
    if (col in out) out[col] = encryptField(out[col] as string | null, aad(sessionId, col));
  }
  return out as T;
}

/** Decrypt the sealed columns of a profile row read back from the database. */
export function openProfileRow<T extends { session_id?: string | null }>(row: T, sessionId?: string): T {
  const sid = sessionId ?? row.session_id;
  if (!sid) return row;
  const out: Record<string, unknown> = { ...row };
  for (const col of LP_PROFILE_SEALED_COLUMNS) {
    if (col in out) out[col] = decryptFieldSafe(out[col] as string | null, aad(sid, col));
  }
  return out as T;
}

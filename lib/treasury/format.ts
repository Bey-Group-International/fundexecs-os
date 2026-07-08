// lib/treasury/format.ts
// Pure, dependency-free display helpers for linked accounts. Kept in their OWN
// module (no Stripe, no DB imports) so client components can import them without
// dragging server-only code (lib/stripe → next/headers) into the browser bundle.
import type { LinkedAccount } from "@/lib/supabase/database.types";

// Mask an account to its last four, e.g. "1234" → "••••1234". Pure.
export function maskAccount(last4: string | null | undefined): string {
  const digits = (last4 ?? "").replace(/\D/g, "").slice(-4);
  return digits ? `••••${digits}` : "••••";
}

// A one-line label for an account row: institution + masked number, falling back
// to the operator's display name. Pure.
export function linkedAccountLabel(
  a: Pick<LinkedAccount, "institution_name" | "display_name" | "last4">,
): string {
  const inst = a.institution_name?.trim() || a.display_name?.trim() || "Bank account";
  return `${inst} ${maskAccount(a.last4)}`.trim();
}

export interface LinkedAccountsSummary {
  count: number;
  active: number;
  totalBalanceCents: number;
}

/**
 * Roll a set of accounts into headline numbers for the treasury panel. Only
 * ACTIVE accounts contribute to the aggregate balance. Pure.
 */
export function summarizeLinkedAccounts(
  accounts: Pick<LinkedAccount, "status" | "balance_cents">[],
): LinkedAccountsSummary {
  let active = 0;
  let totalBalanceCents = 0;
  for (const a of accounts) {
    if (a.status === "active") {
      active += 1;
      if (typeof a.balance_cents === "number") totalBalanceCents += a.balance_cents;
    }
  }
  return { count: accounts.length, active, totalBalanceCents };
}

export function isActive(a: Pick<LinkedAccount, "status">): boolean {
  return a.status === "active";
}

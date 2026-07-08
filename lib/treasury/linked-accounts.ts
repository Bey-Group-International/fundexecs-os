// lib/treasury/linked-accounts.ts
// External bank accounts an org links through Stripe Financial Connections —
// Stripe's own bank-link, the native alternative to Plaid. We never see or store
// account/routing numbers: Stripe returns an account reference (fca_…) plus
// display-safe metadata (institution, last4, type, balance), and we can attach a
// us_bank_account PaymentMethod (pm_…) for ACH debits. This module owns the
// link session, persistence, and the pure display helpers.
//
// As everywhere in lib/, the display helpers are PURE (unit-testable) and the
// Stripe/DB paths are best-effort and gated behind stripeConfigured().
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LinkedAccount, LinkedAccountType } from "@/lib/supabase/database.types";
import { stripeConfigured, getStripe } from "@/lib/stripe";

type Client = SupabaseClient<Database>;

// Pure display helpers live in a Stripe-free module so client components can use
// them without pulling server-only code into the bundle; re-exported here so the
// server surface (this module) stays the single import for callers.
export {
  maskAccount,
  linkedAccountLabel,
  summarizeLinkedAccounts,
  isActive,
  type LinkedAccountsSummary,
} from "@/lib/treasury/format";

// ---------------------------------------------------------------------------
// DB — best-effort persistence (RLS-scoped)
// ---------------------------------------------------------------------------

// The org's linked accounts, newest first. Returns [] on any failure.
export async function listLinkedAccounts(supabase: Client, orgId: string): Promise<LinkedAccount[]> {
  try {
    const { data } = await supabase
      .from("linked_accounts")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    return (data ?? []) as LinkedAccount[];
  } catch {
    return [];
  }
}

export interface RecordLinkedAccountInput {
  stripeFcAccountId?: string | null;
  stripePaymentMethodId?: string | null;
  institutionName?: string | null;
  displayName?: string | null;
  last4?: string | null;
  accountType?: LinkedAccountType;
  balanceCents?: number | null;
  currency?: string;
}

/**
 * Upsert a linked account by its Stripe FC id (so a re-link refreshes rather
 * than duplicates). Returns the row or an error. Best-effort.
 */
export async function recordLinkedAccount(
  supabase: Client,
  orgId: string,
  userId: string | null,
  input: RecordLinkedAccountInput,
): Promise<{ account?: LinkedAccount; error?: string }> {
  try {
    const { data, error } = await supabase
      .from("linked_accounts")
      .upsert(
        {
          organization_id: orgId,
          stripe_fc_account_id: input.stripeFcAccountId ?? null,
          stripe_payment_method_id: input.stripePaymentMethodId ?? null,
          institution_name: input.institutionName ?? null,
          display_name: input.displayName ?? null,
          last4: input.last4 ?? null,
          account_type: input.accountType ?? "checking",
          status: "active",
          balance_cents: input.balanceCents ?? null,
          currency: input.currency ?? "usd",
          created_by: userId,
        },
        { onConflict: "stripe_fc_account_id" },
      )
      .select("*")
      .single();
    if (error) return { error: "Could not save the linked account." };
    return { account: data as LinkedAccount };
  } catch {
    return { error: "Could not save the linked account." };
  }
}

// Mark an account disconnected (kept for transfer history, not deleted).
export async function disconnectLinkedAccount(supabase: Client, orgId: string, accountId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("linked_accounts")
      .update({ status: "disconnected" })
      .eq("id", accountId)
      .eq("organization_id", orgId);
    return !error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stripe — Financial Connections link session (gated)
// ---------------------------------------------------------------------------
/**
 * Create a Stripe Financial Connections session and return its client_secret for
 * the browser to mount the bank-link flow. Returns an error string when Stripe
 * isn't configured or the call fails. Never throws.
 */
export async function createLinkSession(): Promise<{ clientSecret?: string; error?: string }> {
  if (!stripeConfigured()) return { error: "Bank linking isn’t configured yet." };
  try {
    const stripe = getStripe();
    const session = await stripe.financialConnections.sessions.create({
      account_holder: { type: "customer" },
      permissions: ["balances", "payment_method", "ownership"],
      filters: { countries: ["US"] },
    });
    return { clientSecret: session.client_secret };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not start bank linking." };
  }
}

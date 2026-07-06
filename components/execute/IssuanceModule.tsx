// components/execute/IssuanceModule.tsx
// Execute › Issuance — live data wiring for the native digital-securities
// issuance board. Server component: resolves org context, best-effort reads the
// issuance ledger (the native IssuanceProvider persists each drafted security as
// a signing envelope whose document is a subscription agreement — so the ledger
// is the subset of `envelopes` created by the issuance flow, RLS-enforced via
// the request-scoped client) and the org's deals for the draft picker. Every
// read is best-effort — any failure (no org, query error, exception) degrades to
// an empty board rather than throwing, so the Issuance module always renders its
// empty states. The board itself posts to the existing /api/issuance/* routes.
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { IssuanceBoard } from "@/components/execute/IssuanceBoard";
import type { IssuanceDeal } from "@/components/execute/IssuanceBoard";
import {
  deriveLedger,
  SUBSCRIPTION_AGREEMENT_MARKER,
  type IssuanceLedgerRow,
  type RawIssuanceEnvelope,
} from "@/lib/issuance-view";

interface IssuanceData {
  ledger: IssuanceLedgerRow[];
  deals: IssuanceDeal[];
}

const EMPTY: IssuanceData = { ledger: [], deals: [] };

async function loadIssuanceData(): Promise<IssuanceData> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return EMPTY;
    const orgId = ctx.orgId;

    const supabase = await createServerClient();

    const [envelopesRes, dealsRes] = await Promise.all([
      supabase
        .from("envelopes")
        .select("id, title, status, document_content, created_at, completed_at")
        .eq("organization_id", orgId)
        // Issuance envelopes lead with the subscription-agreement marker; this
        // filters out ordinary signing envelopes at the query layer. deriveLedger
        // re-checks the marker defensively.
        .ilike("document_content", `${SUBSCRIPTION_AGREEMENT_MARKER}%`)
        .order("created_at", { ascending: false }),
      supabase
        .from("deals")
        .select("id, name")
        .eq("organization_id", orgId)
        .order("name", { ascending: true }),
    ]);

    const envelopeRows = (envelopesRes.data ?? []) as RawIssuanceEnvelope[];
    const dealRows = (dealsRes.data ?? []) as { id: string; name: string }[];

    return {
      ledger: deriveLedger(envelopeRows),
      deals: dealRows.map((d) => ({ id: d.id, name: d.name })),
    };
  } catch {
    // Best-effort: any failure degrades to the existing empty states.
    return EMPTY;
  }
}

export async function IssuanceModule() {
  const { ledger, deals } = await loadIssuanceData();

  return <IssuanceBoard ledger={ledger} deals={deals} />;
}

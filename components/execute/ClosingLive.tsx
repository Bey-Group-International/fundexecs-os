// components/execute/ClosingLive.tsx
// Execute › Closing — live data wiring for the LP Onboarding + Contract
// Lifecycle boards. Server component: resolves org context, reads the
// lp_onboarding_sessions and contracts tables (RLS-enforced, request-scoped
// client), resolves fund/investor names, and maps each row onto the shape the
// presentational boards expect. Every read is best-effort — any failure (no
// org, query error, exception) degrades to an empty board rather than throwing,
// so the closing page always renders its existing empty states.
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { LPOnboardingStatus } from "@/components/execute/LPOnboardingStatus";
import { ContractStatusBoard } from "@/components/execute/ContractStatusBoard";
import type { OnboardingStatus } from "@/lib/lp-onboarding";
import type { ContractStatus, DocumentType } from "@/lib/contracts";

// Row shapes for the two not-yet-codegen'd tables (migration
// 20260622100000_lp_onboarding_contracts.sql). Only the columns the boards
// consume are typed here; the table reads use an untyped client.
interface OnboardingSessionRow {
  id: string;
  lp_name: string;
  lp_email: string;
  status: OnboardingStatus;
  fund_id: string | null;
  commitment_amount: number | null;
  expires_at: string;
  token: string;
}

interface ContractRow {
  id: string;
  title: string;
  document_type: DocumentType;
  status: ContractStatus;
  investor_id: string | null;
  fund_id: string | null;
  expiry_date: string | null;
  signed_at: string | null;
  effective_date: string | null;
}

interface OnboardingSessionProp {
  id: string;
  lpName: string;
  lpEmail: string;
  status: OnboardingStatus;
  fundName?: string;
  commitmentAmount?: number | null;
  expiresAt: string;
  token: string;
}

interface ContractProp {
  id: string;
  title: string;
  documentType: DocumentType;
  status: ContractStatus;
  investorName?: string;
  fundName?: string;
  expiryDate?: string | null;
  signedAt?: string | null;
  effectiveDate?: string | null;
}

interface ClosingData {
  sessions: OnboardingSessionProp[];
  contracts: ContractProp[];
}

const EMPTY: ClosingData = { sessions: [], contracts: [] };

async function loadClosingData(): Promise<ClosingData> {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return EMPTY;
    const orgId = ctx.orgId;

    const supabase = await createServerClient();

    const [sessionsRes, contractsRes, fundsRes, investorsRes] = await Promise.all([
      supabase
        .from("lp_onboarding_sessions")
        .select(
          "id, lp_name, lp_email, status, fund_id, commitment_amount, expires_at, token",
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false }),
      supabase
        .from("contracts")
        .select(
          "id, title, document_type, status, investor_id, fund_id, expiry_date, signed_at, effective_date",
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false }),
      supabase.from("funds").select("id, name").eq("organization_id", orgId),
      supabase.from("investors").select("id, name").eq("organization_id", orgId),
    ]);

    const fundName = new Map(
      ((fundsRes.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]),
    );
    const investorName = new Map(
      ((investorsRes.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]),
    );

    const sessionRows = (sessionsRes.data ?? []) as OnboardingSessionRow[];
    const contractRows = (contractsRes.data ?? []) as ContractRow[];

    const sessions: OnboardingSessionProp[] = sessionRows.map((r) => ({
      id: r.id,
      lpName: r.lp_name,
      lpEmail: r.lp_email,
      status: r.status,
      fundName: (r.fund_id ? fundName.get(r.fund_id) : undefined) ?? undefined,
      commitmentAmount: r.commitment_amount,
      expiresAt: r.expires_at,
      token: r.token,
    }));

    const contracts: ContractProp[] = contractRows.map((r) => ({
      id: r.id,
      title: r.title,
      documentType: r.document_type,
      status: r.status,
      investorName: (r.investor_id ? investorName.get(r.investor_id) : undefined) ?? undefined,
      fundName: (r.fund_id ? fundName.get(r.fund_id) : undefined) ?? undefined,
      expiryDate: r.expiry_date,
      signedAt: r.signed_at,
      effectiveDate: r.effective_date,
    }));

    return { sessions, contracts };
  } catch {
    // Best-effort: any failure degrades to the existing empty states.
    return EMPTY;
  }
}

export async function ClosingLive() {
  const { sessions, contracts } = await loadClosingData();

  return (
    <>
      <section>
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          LP Onboarding Status
        </p>
        <LPOnboardingStatus sessions={sessions} />
      </section>
      <div className="border-t border-line" />
      <section>
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
          Contract Lifecycle
        </p>
        <ContractStatusBoard contracts={contracts} />
      </section>
    </>
  );
}

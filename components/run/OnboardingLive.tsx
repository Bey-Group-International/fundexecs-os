// components/run/OnboardingLive.tsx
// Run › Onboarding — where a GP takes an LP from invite to an approved decision.
// Server component: reads the org's LP onboarding sessions (RLS-enforced,
// request-scoped client) and shows each LP's stage on the existing board. Reads
// are best-effort, so a missing org or a failed query shows the empty state
// instead of throwing.
//
// The invite, identity, background-check and review stages are built on top of
// this board; for now it is the live view of where every LP stands.
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { LPOnboardingStatus } from "@/components/execute/LPOnboardingStatus";
import type { OnboardingStatus } from "@/lib/lp-onboarding";

interface SessionRow {
  id: string;
  lp_name: string;
  lp_email: string;
  status: OnboardingStatus;
  fund_id: string | null;
  commitment_amount: number | null;
  expires_at: string;
  token: string;
}

async function loadSessions() {
  try {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return [];
    const supabase = await createServerClient();
    const [sessionsRes, fundsRes] = await Promise.all([
      supabase
        .from("lp_onboarding_sessions")
        .select("id, lp_name, lp_email, status, fund_id, commitment_amount, expires_at, token")
        .eq("organization_id", ctx.orgId)
        .order("created_at", { ascending: false }),
      supabase.from("funds").select("id, name").eq("organization_id", ctx.orgId),
    ]);
    const fundName = new Map(((fundsRes.data ?? []) as { id: string; name: string }[]).map((f) => [f.id, f.name]));
    return ((sessionsRes.data ?? []) as SessionRow[]).map((r) => ({
      id: r.id,
      lpName: r.lp_name,
      lpEmail: r.lp_email,
      status: r.status,
      fundName: (r.fund_id ? fundName.get(r.fund_id) : undefined) ?? undefined,
      commitmentAmount: r.commitment_amount,
      expiresAt: r.expires_at,
      token: r.token,
    }));
  } catch {
    return [];
  }
}

export async function OnboardingLive() {
  const sessions = await loadSessions();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header>
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">LP onboarding</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Bring each LP in for evaluation and review: invite them, verify identity and accreditation, run background
          checks, and record your decision.
        </p>
      </header>

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-10 text-center">
          <p className="text-sm text-fg-muted">No LPs are being onboarded yet.</p>
          <p className="mt-1 text-xs text-fg-muted">
            Invite one from an allocator in{" "}
            <Link href="/source/allocators" className="text-gold-300 hover:underline">
              Source › Allocators
            </Link>
            .
          </p>
        </div>
      ) : (
        <LPOnboardingStatus sessions={sessions} />
      )}
    </div>
  );
}

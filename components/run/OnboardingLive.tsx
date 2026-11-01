// components/run/OnboardingLive.tsx
// Run › Onboarding — where a GP takes an LP from invite to an approved decision.
// Server component: reads the org's LP onboarding sessions with their screening
// checks, decisions and activity (RLS-enforced, request-scoped client) and hands
// them to the review cards. Onboarding records hold personal data about LPs, so
// the page is for organization owners and admins only; the database enforces the
// same rule on the check, decision and activity tables.
//
// Reads are best-effort, so a failed query shows the empty state instead of
// throwing.
import { openProfileRow } from "@/lib/lp-pii";
import Link from "next/link";
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";
import { canAdminOrg } from "@/lib/rbac";
import { OnboardingReview, type ReviewLp } from "@/components/run/OnboardingReview";
import { NewLpLink } from "@/components/run/NewLpLink";
import { describeAudit } from "@/lib/onboarding-review";
import type { OnboardingStatus } from "@/lib/lp-onboarding";
import type {
  LpOnboardingConsent,
  LpOnboardingOwner,
  LpOnboardingProfile,
  LpReviewState,
  LpType,
  OnboardingAuditEntry,
  OnboardingCheck,
  OnboardingDecision,
} from "@/lib/supabase/database.types";

interface SessionRow {
  id: string;
  lp_name: string;
  lp_email: string;
  status: OnboardingStatus;
  review_state: LpReviewState;
  lp_type: LpType;
  owner_threshold_pct: number;
  token: string;
  expires_at: string;
  reminded_day3_at: string | null;
  reminded_day6_at: string | null;
}

const STAGE_LABEL: Record<OnboardingStatus, string> = {
  pending: "Invited",
  accreditation: "Accreditation",
  subscription: "Subscription",
  committed: "Committed",
  complete: "Complete",
  expired: "Expired",
};

/** Newest first, grouped by session id. */
function groupBy<T extends { session_id: string | null }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.session_id) continue;
    const list = out.get(r.session_id) ?? [];
    list.push(r);
    out.set(r.session_id, list);
  }
  return out;
}

async function loadFunds(orgId: string): Promise<{ id: string; name: string }[]> {
  try {
    const supabase = await createServerClient();
    const { data } = await supabase.from("funds").select("id, name").eq("organization_id", orgId).order("name");
    return (data ?? []) as { id: string; name: string }[];
  } catch {
    return [];
  }
}

async function loadLps(orgId: string): Promise<ReviewLp[]> {
  try {
    const supabase = await createServerClient();
    const [sessionsRes, checksRes, decisionsRes, auditRes, profilesRes, ownersRes, consentsRes] = await Promise.all([
      supabase
        .from("lp_onboarding_sessions")
        .select("id, lp_name, lp_email, status, review_state, lp_type, owner_threshold_pct, token, expires_at, reminded_day3_at, reminded_day6_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false }),
      supabase.from("onboarding_checks").select("*").eq("organization_id", orgId),
      supabase.from("onboarding_decisions").select("*").eq("organization_id", orgId).order("decided_at", { ascending: false }),
      supabase.from("onboarding_audit_log").select("*").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(300),
      supabase.from("lp_onboarding_profiles").select("*").eq("organization_id", orgId),
      supabase.from("lp_onboarding_owners").select("*").eq("organization_id", orgId).order("created_at", { ascending: true }),
      supabase.from("lp_onboarding_consents").select("*").eq("organization_id", orgId).order("consented_at", { ascending: true }),
    ]);

    const checks = groupBy((checksRes.data ?? []) as OnboardingCheck[]);
    const decisions = groupBy((decisionsRes.data ?? []) as OnboardingDecision[]);
    const audit = groupBy((auditRes.data ?? []) as OnboardingAuditEntry[]);
    const profiles = new Map(((profilesRes.data ?? []) as LpOnboardingProfile[]).map((p) => [p.session_id, openProfileRow(p)]));
    const owners = groupBy((ownersRes.data ?? []) as LpOnboardingOwner[]);
    const consents = groupBy((consentsRes.data ?? []) as LpOnboardingConsent[]);

    return ((sessionsRes.data ?? []) as SessionRow[]).map((s) => ({
      id: s.id,
      lpName: s.lp_name,
      lpEmail: s.lp_email,
      stageLabel: STAGE_LABEL[s.status] ?? s.status,
      reviewState: s.review_state,
      token: s.token,
      expiresAt: s.expires_at,
      remindedAt: [s.reminded_day3_at, s.reminded_day6_at].filter((d): d is string => !!d).sort().pop() ?? null,
      submission: {
        lpType: s.lp_type,
        ownerThresholdPct: s.owner_threshold_pct,
        profile: profiles.has(s.id)
          ? {
              legalName: profiles.get(s.id)!.legal_name,
              entityType: profiles.get(s.id)!.entity_type,
              country: profiles.get(s.id)!.country,
              contactPhone: profiles.get(s.id)!.contact_phone,
              signatoryName: profiles.get(s.id)!.signatory_name,
              signatoryTitle: profiles.get(s.id)!.signatory_title,
              sourceOfFunds: profiles.get(s.id)!.source_of_funds,
              accreditationBasis: profiles.get(s.id)!.accreditation_basis,
              accreditationStatedAt: profiles.get(s.id)!.accreditation_statement_at,
            }
          : null,
        owners: (owners.get(s.id) ?? []).map((o) => ({
          id: o.id,
          fullName: o.full_name,
          role: o.role,
          ownershipPct: o.ownership_pct,
          country: o.country,
        })),
        consents: (consents.get(s.id) ?? []).map((c) => ({ scope: c.scope, typedName: c.typed_name, consentedAt: c.consented_at })),
      },
      checks: (checks.get(s.id) ?? []).map((c) => ({
        kind: c.kind,
        status: c.status,
        method: c.method,
        summary: c.summary,
        checkedAt: c.checked_at,
        expiresAt: c.expires_at,
      })),
      decisions: (decisions.get(s.id) ?? []).map((d) => ({
        id: d.id,
        decision: d.decision,
        reason: d.reason,
        decidedAt: d.decided_at,
      })),
      activity: (audit.get(s.id) ?? []).slice(0, 15).map((a) => ({
        id: a.id,
        text: describeAudit(a.action, a.detail),
        at: a.created_at,
      })),
    }));
  } catch {
    return [];
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header>
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">LP onboarding</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Bring each LP in for evaluation and review: send them a unique link, they complete a short setup, you run
          identity, sanctions, background and accreditation checks and record your decision with the reasoning.
        </p>
      </header>
      {children}
    </div>
  );
}

export async function OnboardingLive() {
  const ctx = await getSessionContext();

  if (!ctx?.orgId || !canAdminOrg(ctx.role)) {
    return (
      <Shell>
        <div className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-10 text-center">
          <p className="text-sm text-fg-muted">
            {ctx?.orgId
              ? "LP onboarding records are visible to organization owners and admins."
              : "Join or create an organization to onboard LPs."}
          </p>
        </div>
      </Shell>
    );
  }

  const [lps, funds] = await Promise.all([loadLps(ctx.orgId), loadFunds(ctx.orgId)]);

  return (
    <Shell>
      <NewLpLink funds={funds} />
      {lps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-10 text-center">
          <p className="text-sm text-fg-muted">No LPs are being onboarded yet.</p>
          <p className="mt-1 text-xs text-fg-muted">
            Make a link above and send it to a prospective LP. You can also invite one from an allocator in{" "}
            <Link href="/source/allocators" className="text-gold-300 hover:underline">
              Source › Allocators
            </Link>
            .
          </p>
        </div>
      ) : (
        <OnboardingReview lps={lps} />
      )}
    </Shell>
  );
}

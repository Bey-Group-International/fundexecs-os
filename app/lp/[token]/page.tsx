// app/lp/[token]/page.tsx
// Public LP onboarding portal — token-gated, no login required.
// The token is the sole auth mechanism; all DB calls use the service-role client.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { LPPortalFlow } from "@/components/lp-portal/LPPortalFlow";
import { LPAccessGate } from "@/components/lp-portal/LPAccessGate";
import { LPWizard, type WizardInitial } from "@/components/lp-portal/LPWizard";
import { hasLpPass } from "@/lib/lp-access.server";
import { maskEmail } from "@/lib/lp-wizard";
import { stripeIdentityProvider } from "@/lib/providers/stripe-identity";
import { readIdentityCheck } from "@/lib/lp-identity.server";
import { loadDetailsPrefill } from "@/lib/lp-prefill.server";
import type { IdentityState } from "@/lib/lp-identity";
import type { LpType } from "@/lib/supabase/database.types";
import { renderDocumentTemplate } from "@/lib/document-templates";
import type { OnboardingStatus } from "@/lib/lp-onboarding";

export const dynamic = "force-dynamic";

function Unavailable({ reason }: { reason?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">FundExecs OS</span>
      <h1 className="mt-3 font-display text-2xl font-semibold text-fg-primary">
        {reason === "expired" ? "This link has expired" : "Link not available"}
      </h1>
      <p className="mt-2 max-w-sm text-sm text-fg-secondary">
        {reason === "expired"
          ? "Your onboarding link has expired. Contact your fund manager for a new one."
          : "This link is invalid or has already been used. Contact your fund manager."}
      </p>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border border-line bg-surface-1 p-6 text-center">
      <h2 className="font-display text-lg font-semibold text-fg-primary">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-fg-secondary">{body}</p>
    </section>
  );
}

export default async function LPOnboardingPortal(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  if (!hasSupabaseServiceEnv()) return <Unavailable />;
  const supabase = createServiceClient();

  const { data: sessionRow } = await supabase
    .from("lp_onboarding_sessions")
    .select(
      "id, lp_name, lp_email, status, fund_id, investor_id, commitment_amount, wire_instructions, expires_at, organization_id, lp_type, owner_threshold_pct, review_state",
    )
    .eq("token", params.token)
    .maybeSingle();

  if (!sessionRow) return <Unavailable />;
  if (new Date(sessionRow.expires_at as string).getTime() < Date.now()) {
    return <Unavailable reason="expired" />;
  }
  if (sessionRow.status === "expired") return <Unavailable reason="expired" />;

  const status = sessionRow.status as OnboardingStatus;
  const orgId = sessionRow.organization_id as string;

  const [orgResult, fundResult] = await Promise.all([
    supabase.from("organizations").select("name, jurisdiction").eq("id", orgId).maybeSingle(),
    sessionRow.fund_id
      ? supabase.from("funds").select("name").eq("id", sessionRow.fund_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const orgName = (orgResult.data?.name as string | undefined) ?? "the fund manager";
  const fundName = (fundResult.data?.name as string | undefined) ?? "the fund";
  const lpName = sessionRow.lp_name as string;
  const commitmentAmount = sessionRow.commitment_amount as number | null;
  const wireInstructions = (sessionRow.wire_instructions ?? {}) as Record<string, string>;
  const jurisdiction = (orgResult.data?.jurisdiction as string | undefined) ?? "Delaware";

  const reviewState = sessionRow.review_state as string;
  const sessionId = sessionRow.id as string;

  // What the LP sees depends on whether they have proved it is them, and where the
  // fund manager's review stands.
  async function content() {
    if (reviewState === "rejected") {
      return <Notice title="This link isn't available" body="Contact your fund manager if you have questions." />;
    }
    if (!(await hasLpPass(sessionId))) {
      return <LPAccessGate token={params.token} maskedEmail={maskEmail(sessionRow!.lp_email as string)} />;
    }
    if (reviewState === "approved") {
      return (
        <LPPortalFlow
          token={params.token}
          initialStatus={status}
          lpName={lpName}
          fundName={fundName}
          commitmentAmount={commitmentAmount}
          wireInstructions={wireInstructions}
          subscriptionContent={subscriptionContent}
        />
      );
    }
    if (reviewState === "submitted") {
      return (
        <Notice
          title="Thank you. You're under review."
          body={`${orgName} is reviewing what you've submitted. You'll hear from them directly, and you can come back to this link to continue once you're approved.`}
        />
      );
    }
    const identityEnabled = stripeIdentityProvider.isConfigured();
    const identityCheck = identityEnabled ? await readIdentityCheck(supabase, sessionId) : null;
    // A started Stripe verification is "needs_input" until the wizard asks Stripe how it went.
    const identityState: IdentityState = !identityCheck
      ? "none"
      : identityCheck.status === "clear"
        ? "verified"
        : identityCheck.status === "failed"
          ? "canceled"
          : identityCheck.method === "stripe_identity"
            ? "needs_input"
            : "none";
    const [profileRes, ownersRes, consentsRes] = await Promise.all([
      supabase.from("lp_onboarding_profiles").select("*").eq("session_id", sessionId).maybeSingle(),
      supabase.from("lp_onboarding_owners").select("*").eq("session_id", sessionId).order("created_at", { ascending: true }),
      supabase.from("lp_onboarding_consents").select("*").eq("session_id", sessionId).order("consented_at", { ascending: true }),
    ]);
    const p = (profileRes.data ?? null) as Record<string, string | null> | null;
    // Until the LP has saved their details, suggest what the fund manager already has on file for them.
    const suggested = p
      ? {}
      : await loadDetailsPrefill(supabase, { orgId, investorId: (sessionRow!.investor_id as string | null) ?? null, lpType: sessionRow!.lp_type as LpType });
    const initial: WizardInitial = {
      legalName: p?.legal_name ?? suggested.legalName ?? lpName,
      entityType: (p?.entity_type ?? (sessionRow!.lp_type === "individual" ? "individual" : "")) as WizardInitial["entityType"],
      country: p?.country ?? "",
      contactPhone: p?.contact_phone ?? "",
      signatoryName: p?.signatory_name ?? "",
      signatoryTitle: p?.signatory_title ?? "",
      sourceOfFunds: p?.source_of_funds ?? "",
      accreditationBasis: (p?.accreditation_basis ?? "") as WizardInitial["accreditationBasis"],
      accreditationStated: Boolean(p?.accreditation_statement_at),
      owners: ((ownersRes.data ?? []) as Array<{ full_name: string; role: "owner" | "controller"; ownership_pct: number | null; country: string | null }>).map((o) => ({
        fullName: o.full_name,
        role: o.role,
        ownershipPct: o.ownership_pct === null ? "" : String(o.ownership_pct),
        country: o.country ?? "",
      })),
      consents: ((consentsRes.data ?? []) as Array<{ scope: WizardInitial["consents"][number]["scope"]; text_version: string; typed_name: string; consented_at: string }>).map((c) => ({
        scope: c.scope,
        textVersion: c.text_version,
        typedName: c.typed_name,
        consentedAt: c.consented_at,
      })),
    };
    return (
      <LPWizard
        token={params.token}
        lpType={sessionRow!.lp_type as LpType}
        ownerThresholdPct={sessionRow!.owner_threshold_pct as number}
        changesRequested={reviewState === "changes_requested"}
        identity={{ enabled: identityEnabled, state: identityState }}
        initial={initial}
        suggested={suggested}
      />
    );
  }

  const subscriptionContent = renderDocumentTemplate("subscription_agreement", {
    fundName,
    orgName,
    jurisdiction,
    effectiveDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    investorName: lpName,
    commitmentAmount: commitmentAmount
      ? `$${Number(commitmentAmount).toLocaleString("en-US")}`
      : undefined,
  });

  return (
    <main className="min-h-screen bg-surface-0 text-fg-primary">
      <div className="mx-auto max-w-xl px-6 py-12">
        {/* Header */}
        <header className="mb-8 border-b border-line pb-6">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-gold-300">
            FundExecs OS
          </span>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">{orgName}</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            LP Onboarding · <span className="text-fg-primary">{lpName}</span>
          </p>
          {commitmentAmount && (
            <p className="mt-1 font-mono text-sm text-gold-300">
              ${Number(commitmentAmount).toLocaleString("en-US")} commitment
            </p>
          )}
        </header>

        {await content()}

        <footer className="mt-12 border-t border-line pt-6 text-center">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            Powered by FundExecs OS
          </span>
        </footer>
      </div>
    </main>
  );
}

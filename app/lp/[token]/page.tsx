// app/lp/[token]/page.tsx
// Public LP onboarding portal — token-gated, no login required.
// The token is the sole auth mechanism; all DB calls use the service-role client.
import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { LPPortalFlow } from "@/components/lp-portal/LPPortalFlow";
import { renderDocumentTemplate } from "@/lib/document-templates";
import type { OnboardingStatus } from "@/lib/lp-onboarding";

export const dynamic = "force-dynamic";

function Unavailable({ reason }: { reason?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-0 px-6 text-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">FundExecs OS</span>
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

export default async function LPOnboardingPortal(props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  if (!hasSupabaseServiceEnv()) return <Unavailable />;
  const supabase = createServiceClient();

  const { data: sessionRow } = await supabase
    .from("lp_onboarding_sessions")
    .select(
      "id, lp_name, lp_email, status, fund_id, investor_id, commitment_amount, wire_instructions, expires_at, organization_id",
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
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
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

        {/* Multi-step flow */}
        <LPPortalFlow
          token={params.token}
          initialStatus={status}
          lpName={lpName}
          fundName={fundName}
          commitmentAmount={commitmentAmount}
          wireInstructions={wireInstructions}
          subscriptionContent={subscriptionContent}
        />

        <footer className="mt-12 border-t border-line pt-6 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-fg-muted">
            Powered by FundExecs OS
          </span>
        </footer>
      </div>
    </main>
  );
}

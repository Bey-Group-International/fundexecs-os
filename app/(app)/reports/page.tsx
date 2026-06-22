import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { getLpReport } from "@/lib/lp-report";
import { LpReport } from "@/components/reports/LpReport";
import { LPOnboardingStatus } from "@/components/execute/LPOnboardingStatus";
import type { OnboardingStatus } from "@/lib/lp-onboarding";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (!ctx.orgId) redirect("/onboarding");

  const supabase = createServerClient();

  const [report, sharesRes, investorsRes] = await Promise.all([
    getLpReport(ctx.orgId),
    supabase
      .from("investor_portal_shares")
      .select("id, investor_id, token, expires_at, created_at, revoked_at")
      .eq("organization_id", ctx.orgId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("investors")
      .select("id, name, contact_email")
      .eq("organization_id", ctx.orgId),
  ]);

  const investorMap = new Map(
    (investorsRes.data ?? []).map((i) => [i.id, i])
  );

  const now = new Date().toISOString();
  const onboardingSessions = (sharesRes.data ?? []).map((share) => {
    const investor = investorMap.get(share.investor_id);
    const isExpired = share.expires_at && share.expires_at < now;
    const status: OnboardingStatus = isExpired ? "expired" : "pending";
    return {
      id: share.id,
      lpName: investor?.name ?? "Unknown LP",
      lpEmail: investor?.contact_email ?? "",
      status,
      expiresAt: share.expires_at ?? now,
      token: share.token,
    };
  });

  return (
    <div className="mx-auto max-w-4xl">
      <LpReport report={report} />

      {onboardingSessions.length > 0 && (
        <section className="mt-12">
          <header className="mb-6">
            <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-gold-400">
              Execute
            </span>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-fg-primary">
              LP Onboarding Status
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Active LP onboarding sessions — accreditation, subscription docs, and capital commitment progress.
            </p>
          </header>
          <LPOnboardingStatus sessions={onboardingSessions} />
        </section>
      )}
    </div>
  );
}

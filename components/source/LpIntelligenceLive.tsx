// components/source/LpIntelligenceLive.tsx
// Async server component — loads the firm's allocators, its mandate (primary
// strategy + active thesis), and existing commitments, scores every LP against
// the mandate with the deterministic lib/lp-scoring model, then hands off to the
// LpIntelligenceBoard client component for the interactive tiered view.
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { scoreLpFit, factorsFromInvestor, lpMandateFrom } from "@/lib/lp-scoring";
import type { Investor } from "@/lib/supabase/database.types";
import { LpIntelligenceBoard } from "@/components/source/LpIntelligenceBoard";
import type { ScoredLp } from "@/components/source/LpIntelligenceBoard";

export async function LpIntelligenceLive() {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return <LpIntelligenceBoard lps={[]} hasMandate={false} strategy={null} />;
  }

  const supabase = await createServerClient();
  const orgId = auth.ctx.orgId;

  const [orgRes, thesisRes, investorsRes, commitmentsRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("primary_strategy, fund_count")
      .eq("id", orgId)
      .maybeSingle(),
    supabase
      .from("investment_theses")
      .select("check_size_min, check_size_max, geographies")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1),
    supabase
      .from("investors")
      .select("*")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .limit(500),
    supabase.from("commitments").select("investor_id, committed_amount").limit(2000),
  ]);

  const org = orgRes.data ?? { primary_strategy: null, fund_count: null };
  const thesis = thesisRes.data?.[0] ?? null;
  const investors = (investorsRes.data ?? []) as Investor[];
  const mandate = lpMandateFrom(org, thesis);

  const committedByInvestor = new Map<string, number>();
  for (const c of commitmentsRes.data ?? []) {
    committedByInvestor.set(
      c.investor_id,
      (committedByInvestor.get(c.investor_id) ?? 0) + Number(c.committed_amount ?? 0),
    );
  }

  const lps: ScoredLp[] = investors
    .map((inv): ScoredLp => {
      const fit = scoreLpFit(mandate, factorsFromInvestor(inv));
      return {
        id: inv.id,
        name: inv.name,
        investorType: inv.investor_type,
        aum: inv.aum,
        checkMin: inv.typical_check_min,
        checkMax: inv.typical_check_max,
        jurisdiction: inv.jurisdiction,
        // Enrichable scoring signals — surfaced so the board's inline editor can
        // seed them and the score sharpens as they're filled in.
        sectors: inv.sectors ?? [],
        openToEmergingManagers: inv.open_to_emerging_managers ?? null,
        allocationSignal: inv.allocation_signal ?? null,
        committed: committedByInvestor.get(inv.id) ?? 0,
        score: fit.score,
        tier: fit.tier,
        factors: fit.factors,
      };
    })
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const hasMandate = !!(
    mandate.strategy ||
    mandate.checkMin != null ||
    mandate.checkMax != null ||
    mandate.geographies.length
  );

  return (
    <LpIntelligenceBoard lps={lps} hasMandate={hasMandate} strategy={mandate.strategy} />
  );
}

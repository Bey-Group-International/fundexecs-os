// Auto-derive GP Profile Scorecard from existing org data.
// Reads assets, deals, partners, thesis, investors, and service providers
// to compute the five GPLPMatch evaluation dimensions without manual input.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface GPScorecardData {
  overallScore: number;
  trackRecord: { score: number; moicAvg: number | null; irrAvg: number | null; dealCount: number };
  teamStrength: { score: number; seniorYears: number | null; boardSeats: number | null };
  thesisClarity: { score: number; sectorsCount: number; stagesCount: number };
  networkReach: { score: number; lpRelationships: number; coInvestors: number };
  operationalReadiness: { score: number; hasAuditor: boolean; hasCounsel: boolean; hasAdmin: boolean };
}

export async function computeGPScorecard(
  supabase: SupabaseClient,
  orgId: string
): Promise<GPScorecardData> {
  const [assetsRes, dealsRes, partnersRes, thesisRes, investorsRes, serviceRes] = await Promise.all([
    supabase.from("assets").select("moic, cost, nav, created_at").eq("organization_id", orgId),
    supabase.from("deals").select("id, stage").eq("organization_id", orgId),
    supabase.from("partners").select("id, partner_type, role, created_at").eq("organization_id", orgId),
    supabase.from("investment_thesis").select("asset_classes, geographies, target_irr, target_moic").eq("organization_id", orgId).eq("is_active", true).limit(1),
    supabase.from("investors").select("id, investor_type").eq("organization_id", orgId),
    supabase.from("service_providers").select("id, provider_type").eq("organization_id", orgId),
  ]);

  // ── Track Record ─────────────────────────────────────────────────────────
  const assets = assetsRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const moics = assets.map((a) => a.moic).filter((m): m is number => m != null);
  const moicAvg = moics.length ? moics.reduce((s, m) => s + m, 0) / moics.length : null;
  const dealCount = deals.length;

  // Score: >2× avg moic → 90, >1.5× → 70, >1× → 50, else 20; bonus for volume
  let trackScore = 20;
  if (moicAvg != null) {
    trackScore = moicAvg >= 2.5 ? 90 : moicAvg >= 2 ? 75 : moicAvg >= 1.5 ? 60 : moicAvg >= 1 ? 45 : 20;
  }
  trackScore = Math.min(100, trackScore + Math.min(10, dealCount));

  // ── Team Strength ─────────────────────────────────────────────────────────
  const partners = partnersRes.data ?? [];
  const seniorPartners = partners.filter((p) =>
    /(principal|partner|managing|director|vp|vice|senior|founder)/i.test(p.partner_type + " " + (p.role ?? ""))
  );
  // Proxy years from earliest partner created_at
  let seniorYears: number | null = null;
  if (partners.length > 0) {
    const earliest = partners.reduce((min, p) =>
      p.created_at < min.created_at ? p : min, partners[0]);
    seniorYears = Math.round((Date.now() - new Date(earliest.created_at).getTime()) / (365.25 * 86400000));
  }
  const teamScore = Math.min(100, 20 + seniorPartners.length * 20 + (partners.length > 0 ? 10 : 0));

  // ── Thesis Clarity ────────────────────────────────────────────────────────
  const thesis = thesisRes.data?.[0] ?? null;
  const sectorsCount = thesis?.asset_classes?.length ?? 0;
  const stagesCount = thesis?.geographies?.length ?? 0;
  const thesisScore = thesis
    ? Math.min(100, 30 + sectorsCount * 15 + stagesCount * 10 + (thesis.target_moic ? 15 : 0) + (thesis.target_irr ? 10 : 0))
    : 10;

  // ── Network Reach ─────────────────────────────────────────────────────────
  const investors = investorsRes.data ?? [];
  const lpCount = investors.filter((i) =>
    /(lp|limited|family.office|endowment|pension|foundation|hnw|angel)/i.test(i.investor_type)
  ).length;
  const coInvestors = investors.length - lpCount;
  const networkScore = Math.min(100, 10 + lpCount * 5 + coInvestors * 3);

  // ── Operational Readiness ─────────────────────────────────────────────────
  const providers = serviceRes.data ?? [];
  const hasAuditor = providers.some((p) => /(audit|accounting|cpa)/i.test(p.provider_type));
  const hasCounsel = providers.some((p) => /(legal|counsel|law|attorney)/i.test(p.provider_type));
  const hasAdmin = providers.some((p) => /(admin|fund.admin|administrator|compliance)/i.test(p.provider_type));
  const opsScore = 10 + (hasAuditor ? 30 : 0) + (hasCounsel ? 30 : 0) + (hasAdmin ? 30 : 0);

  const overall = Math.round(
    trackScore * 0.30 +
    teamScore * 0.25 +
    thesisScore * 0.20 +
    networkScore * 0.15 +
    opsScore * 0.10
  );

  return {
    overallScore: overall,
    trackRecord: { score: trackScore, moicAvg, irrAvg: null, dealCount },
    teamStrength: { score: teamScore, seniorYears, boardSeats: seniorPartners.length },
    thesisClarity: { score: thesisScore, sectorsCount, stagesCount },
    networkReach: { score: networkScore, lpRelationships: lpCount, coInvestors },
    operationalReadiness: { score: opsScore, hasAuditor, hasCounsel, hasAdmin },
  };
}

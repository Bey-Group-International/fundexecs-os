// lib/proactive/triggers/cold-lp.ts
// The canonical initiative surface: cold-LP decay. An LP has gone silent past
// its cadence; Earn proposes a warm re-approach — drafted, grounded in the
// firm's fund performance vs cohort (Carta PMI), and staged for approval.
//
// This is a MARKET-aware internal signal: the silence is internal state
// (relationship_scores.decay_alert), the credibility is external intelligence
// (Carta DPI/TVPI percentile). The draft arrives as a finished decision, not an
// alert — "3 LPs went cold → warm re-approach drafted with your top-quartile
// DPI, awaiting approval."

import { benchmarkWithCache } from "@/lib/proactive/pmi/registry";
import { benchmarkToClaim } from "@/lib/proactive/pmi/types";
import type { Signal } from "@/lib/proactive/types";
import type { TriggerContext, TriggerDefinition, EnrichedSignal } from "./types";

/** Map days-silent to a base urgency (0–100). Steeper past the cadence window. */
export function silenceUrgency(daysSilent: number): number {
  if (daysSilent >= 120) return 90;
  if (daysSilent >= 90) return 78;
  if (daysSilent >= 60) return 62;
  if (daysSilent >= 30) return 45;
  return 30;
}

export const coldLpTrigger: TriggerDefinition = {
  key: "cold_lp",
  label: "Cold LP re-approach",
  hub: "source",
  signalClass: "market",
  sendAction: "send_outreach", // Tier 2 — gated before anything reaches the LP
  enabled: true,

  async detect(ctx: TriggerContext): Promise<Signal[]> {
    const { data, error } = await ctx.supabase
      .from("relationship_scores")
      .select("investor_id, score, temperature, days_since_contact, decay_alert, decay_days, last_contact_at")
      .eq("organization_id", ctx.orgId)
      .eq("decay_alert", true)
      .order("days_since_contact", { ascending: false })
      .limit(25);
    if (error || !data || data.length === 0) return [];

    // Resolve investor names in one round trip.
    const ids = data.map((r) => (r as { investor_id: string }).investor_id).filter(Boolean);
    const nameById = new Map<string, string>();
    if (ids.length) {
      const { data: investors } = await ctx.supabase
        .from("investors")
        .select("id, name")
        .eq("organization_id", ctx.orgId)
        .in("id", ids);
      for (const inv of (investors ?? []) as Array<{ id: string; name: string }>) {
        nameById.set(inv.id, inv.name);
      }
    }

    return (data as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => {
      const daysSilent = Number(r.days_since_contact ?? r.decay_days ?? 0);
      const investorId = String(r.investor_id ?? "");
      const name = nameById.get(investorId) ?? "an LP";
      return {
        triggerKey: "cold_lp",
        hub: "source",
        signalClass: "market",
        subjectType: "investor",
        subjectId: investorId || null,
        subjectName: name,
        summary: `${name} has gone quiet — ${daysSilent} days since last contact.`,
        occurredAt: String(r.last_contact_at ?? new Date().toISOString()),
        baseConfidence: 60,
        baseUrgency: silenceUrgency(daysSilent),
        metadata: {
          daysSilent,
          temperature: r.temperature ?? null,
          score: r.score ?? null,
        },
      } satisfies Signal;
    });
  },

  async enrich(ctx: TriggerContext, signal: Signal): Promise<EnrichedSignal> {
    // Pull the firm's DPI vs cohort from Carta (PMI) — the credibility hook for
    // the re-approach. This is what makes the draft land as a grounded decision.
    const dpi = await benchmarkWithCache(ctx.orgId, "carta", { metric: "dpi" });
    const claim = benchmarkToClaim(dpi);
    const claims = claim ? [claim] : [];

    // PMI feeds ranking: a top-quartile, well-grounded benchmark raises both the
    // confidence (we have a credible reason to re-approach) and the urgency (a
    // strong mark is a perishable reason to reach out now).
    let confidence = signal.baseConfidence;
    let urgency = signal.baseUrgency;
    if (claim) {
      const pctBoost = claim.verified ? 20 : 10; // verified Carta > modeled estimate
      confidence = Math.min(100, confidence + pctBoost);
      const topQuartile = /top-quartile/i.test(claim.claim);
      if (topQuartile) urgency = Math.min(100, urgency + 12);
    }

    return { signal, claims, urgency, confidence };
  },

  compose(enriched: EnrichedSignal): { objective: string; title: string } {
    const { signal, claims } = enriched;
    const name = signal.subjectName;
    const days = Number((signal.metadata as { daysSilent?: number }).daysSilent ?? 0);
    const grounding = claims.length
      ? ` Ground the outreach in our fund performance: ${claims.map((c) => c.claim).join("; ")} (cite source ${claims.map((c) => c.source).join(", ")} with as-of dates).`
      : "";
    return {
      title: `${name} went cold (${days}d) — warm re-approach drafted`,
      objective:
        `Draft a warm, personal re-approach message to ${name}, a limited partner who has gone silent for ${days} days.` +
        grounding +
        ` Keep it concise and relationship-first. Produce ONLY the draft for my review — do not send anything.`,
    };
  },
};

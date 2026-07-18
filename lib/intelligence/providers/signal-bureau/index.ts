// lib/intelligence/providers/signal-bureau/index.ts
// The Signal Bureau connector — an OPTIONAL IntelligenceProvider. Removing it
// (or disabling its flag) must not affect the native intelligence core; it is a
// pure feed behind the provider seam (lib/intelligence/provider.ts).
//
// Three operating modes, exactly as documented:
//   • REST Feed  (fetchObservations) — scheduled ingestion + browsing. LIVE.
//   • MCP Tools  — agent-initiated entity lookups / dossiers / calibration. The
//     tool surface (get_signals, ask, top_accelerating, search_entities,
//     get_entity, get_events, get_calibration, todays_brief) is DECLARED; the
//     runtime binding reuses the existing MCP client seam and is gated behind
//     provider_signal_bureau_mcp. Degrades gracefully when unbound.
//   • ask()      — future-event / scenario reasoning only, gated behind
//     provider_signal_bureau_ask. Never used for routine historical facts.
//
// `get_record` is intentionally NOT implemented — treated as retired.

import { createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import type { AskResult, FetchResult, FetchSpec, IntelligenceProvider, ProviderCalibration } from "@/lib/intelligence/types";
import { capabilityEnabled } from "@/lib/intelligence/flags";
import { getConnection, resolveToken } from "@/lib/intelligence/connections";
import { adaptSignals } from "./adapter";
import { ask as askRest, getSignals, getStats, type ClientConfig } from "./client";

/** The MCP tools the connector maps to when MCP mode is bound (declared surface). */
export const SIGNAL_BUREAU_MCP_TOOLS = [
  "get_signals",
  "ask",
  "top_accelerating",
  "search_entities",
  "get_entity",
  "get_events",
  "get_calibration",
  "todays_brief",
] as const;

function svc() {
  return createServiceClient();
}

/** Resolve the REST client config for a workspace, or null if not usable. */
async function clientConfig(workspaceId: string): Promise<ClientConfig | null> {
  if (!hasSupabaseServiceEnv()) return null;
  const supabase = svc();
  const conn = await getConnection(supabase, workspaceId, "signal_bureau");
  if (!conn || conn.status !== "connected") return null;
  const baseUrl = typeof conn.config.baseUrl === "string" ? conn.config.baseUrl : process.env.SIGNAL_BUREAU_BASE_URL;
  if (!baseUrl) return null;
  const token = await resolveToken(supabase, workspaceId, "signal_bureau");
  const timeoutMs = typeof conn.config.timeoutMs === "number" ? conn.config.timeoutMs : undefined;
  return { baseUrl, token, timeoutMs };
}

export const signalBureauProvider: IntelligenceProvider = {
  key: "signal_bureau",
  label: "Signal Bureau",

  async available(workspaceId: string): Promise<boolean> {
    if (!capabilityEnabled("provider_signal_bureau")) return false;
    const cfg = await clientConfig(workspaceId);
    return cfg !== null;
  },

  async fetchObservations(workspaceId: string, spec: FetchSpec): Promise<FetchResult> {
    const empty: FetchResult = { observations: [], warnings: [], schemaDrift: false, degraded: true };
    if (!capabilityEnabled("provider_signal_bureau")) {
      return { ...empty, warnings: ["signal_bureau provider flag disabled"] };
    }
    const cfg = await clientConfig(workspaceId);
    if (!cfg) return { ...empty, warnings: ["signal_bureau not connected for this workspace"] };

    const res = await getSignals(cfg, { limit: spec.limit ?? 50, since: spec.since, entities: spec.entities });
    if (!res.ok) {
      return {
        observations: [],
        warnings: [`signals fetch failed: ${res.error}`],
        schemaDrift: false,
        degraded: true,
      };
    }

    const signals = res.data.signals ?? res.data.data ?? [];
    const { observations, driftKeys } = adaptSignals(signals);
    return {
      observations,
      warnings: driftKeys.length ? [`schema drift: unknown fields ${driftKeys.join(", ")}`] : [],
      schemaDrift: driftKeys.length > 0,
      degraded: false,
    };
  },

  async ask(workspaceId: string, question: string): Promise<AskResult> {
    const degraded: AskResult = {
      answer: "",
      evidenceStatus: "unknown",
      confidence: 0,
      asOf: null,
      sourceUrls: [],
      degraded: true,
    };
    if (!capabilityEnabled("provider_signal_bureau_ask")) return degraded;
    const cfg = await clientConfig(workspaceId);
    if (!cfg) return degraded;

    const res = await askRest(cfg, question);
    if (!res.ok) return degraded;
    const d = res.data;
    const status = (d.evidence_status ?? "unknown").toLowerCase();
    return {
      answer: typeof d.answer === "string" ? d.answer : "",
      evidenceStatus:
        status === "receipted" || status === "corroborated" || status === "unreceipted" ? (status as AskResult["evidenceStatus"]) : "unknown",
      confidence: typeof d.confidence === "number" ? Math.max(0, Math.min(1, d.confidence > 1 ? d.confidence / 100 : d.confidence)) : 0,
      asOf: typeof d.as_of === "string" ? d.as_of : null,
      sourceUrls: Array.isArray(d.sources) ? d.sources.filter((s): s is string => typeof s === "string") : [],
      degraded: false,
    };
  },

  async calibration(workspaceId: string): Promise<ProviderCalibration | null> {
    if (!capabilityEnabled("provider_signal_bureau")) return null;
    const cfg = await clientConfig(workspaceId);
    if (!cfg) return null;
    const res = await getStats(cfg);
    if (!res.ok) return null;
    const d = res.data;
    const reliability = d.calibration?.reliability ?? d.calibration?.hit_rate ?? d.reliability ?? null;
    return {
      reliability: typeof reliability === "number" ? Math.max(0, Math.min(1, reliability > 1 ? reliability / 100 : reliability)) : null,
      methodology: typeof d.methodology === "string" ? d.methodology : null,
      asOf: typeof d.as_of === "string" ? d.as_of : null,
    };
  },
};

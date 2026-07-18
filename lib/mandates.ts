// lib/mandates.ts
// The bridge between the persisted `mandates` table (migration 0029) and the
// pure gate layer (lib/gates.ts). The DB stores the operator's standing
// delegation as a row; the gate consumes the lightweight `Mandate` shape
// (`{ autoApprove, autonomyCeiling }`). This module reads the active row and
// translates it into that shape.
//
// Tenancy is enforced by RLS, so we never filter by organization_id here — the
// RLS-scoped client only ever sees the caller's org (same convention as
// lib/capital-map.ts / lib/graph.ts). The `orgId` argument is accepted for
// call-site clarity and forward use but is intentionally not used to filter.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MandateRow } from "@/lib/supabase/database.types";
import type { ActionKind, BlastRadius, GateTier, Mandate } from "@/lib/gates";
import { parseScreeningCriteria, type ScreeningCriteria } from "@/lib/skills/screening-criteria";

type Client = SupabaseClient<Database>;

// Guardrails are stored as a jsonb array of `{ rule: string }`. Flatten to a
// clean list of non-empty rule strings for the gate-layer `Mandate` and for
// Earn's context. Tolerant of legacy/garbage shapes: anything that isn't a
// `{rule: string}` with text is dropped.
export function parseGuardrails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    const rule =
      entry && typeof entry === "object" && typeof (entry as { rule?: unknown }).rule === "string"
        ? (entry as { rule: string }).rule.trim()
        : typeof entry === "string"
          ? entry.trim()
          : "";
    if (rule) out.push(rule);
  }
  return out;
}

// Blast-radius rules are stored as a jsonb array of `{ type, value }` entries so
// the schema can grow without a migration. Normalize them into the structured
// `BlastRadius` the gate enforces. Unknown types and malformed values are
// ignored; forbidden domains accumulate.
export function parseBlastRadius(raw: unknown): BlastRadius {
  const br: BlastRadius = {};
  if (!Array.isArray(raw)) return br;
  const domains: string[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { type, value } = entry as { type?: unknown; value?: unknown };
    switch (type) {
      case "max_outreach_per_day": {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) br.maxOutreachPerDay = Math.trunc(n);
        break;
      }
      case "max_dollar_per_action": {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) br.maxDollarPerAction = n;
        break;
      }
      case "forbidden_domain": {
        if (typeof value === "string" && value.trim()) domains.push(value.trim());
        break;
      }
    }
  }
  if (domains.length) br.forbiddenDomains = domains;
  return br;
}

// The inverse of `parseBlastRadius`: serialize a structured `BlastRadius` back to
// the persisted `{ type, value }[]` jsonb shape for storage. Omits absent limits.
export function blastRadiusToRules(br: BlastRadius): Array<{ type: string; value: string | number }> {
  const rules: Array<{ type: string; value: string | number }> = [];
  if (br.maxOutreachPerDay != null) rules.push({ type: "max_outreach_per_day", value: br.maxOutreachPerDay });
  if (br.maxDollarPerAction != null) rules.push({ type: "max_dollar_per_action", value: br.maxDollarPerAction });
  for (const d of br.forbiddenDomains ?? []) rules.push({ type: "forbidden_domain", value: d });
  return rules;
}

// Compose the operator's scope, guardrails, and blast-radius limits into a
// compact prose block for injection into Earn's context, so the copilot respects
// the standing delegation's constraints in every reply. Returns "" when there is
// nothing to say, so callers can skip an empty section.
export function mandateContextBlock(
  row: Pick<MandateRow, "scope" | "guardrails" | "blast_radius_rules"> | undefined,
): string {
  if (!row) return "";
  const parts: string[] = [];
  const scope = row.scope?.trim();
  if (scope) parts.push(`Scope: ${scope}`);

  const guardrails = parseGuardrails(row.guardrails);
  if (guardrails.length) {
    parts.push(`Guardrails Earn must respect:\n${guardrails.map((g) => `  - ${g}`).join("\n")}`);
  }

  const br = parseBlastRadius(row.blast_radius_rules);
  const limits: string[] = [];
  if (br.maxOutreachPerDay != null) limits.push(`max ${br.maxOutreachPerDay} automated sends/day`);
  if (br.maxDollarPerAction != null) limits.push(`no automated action above $${br.maxDollarPerAction.toLocaleString("en-US")}`);
  if (br.forbiddenDomains?.length) limits.push(`never contact: ${br.forbiddenDomains.join(", ")}`);
  if (limits.length) parts.push(`Blast-radius limits: ${limits.join("; ")}.`);

  if (!parts.length) return "";
  return `## Active mandate\n${parts.join("\n")}`;
}

/**
 * Resolve the org's active mandate as the gate-layer `Mandate`, or `undefined`
 * when none is active. The most recently updated active row wins. The autonomy
 * ceiling is clamped to a valid GateTier (the DB caps it at 2 — Tier 3 is never
 * delegable — but clamp defensively in case the row predates that constraint).
 */
export async function getActiveMandate(
  supabase: Client,
  orgId?: string,
): Promise<Mandate | undefined> {
  // RLS scopes the client to the caller's org, so we never filter by orgId;
  // it is accepted for call-site clarity and forward use.
  void orgId;

  const { data } = await supabase
    .from("mandates")
    .select("auto_approve, autonomy_ceiling, scope, guardrails, blast_radius_rules")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return undefined;

  const autonomyCeiling = Math.min(2, Math.max(1, data.autonomy_ceiling)) as GateTier;
  const guardrails = parseGuardrails(data.guardrails);
  const blastRadius = parseBlastRadius(data.blast_radius_rules);
  return {
    autoApprove: (data.auto_approve ?? []) as ActionKind[],
    autonomyCeiling,
    // Only attach when non-empty so the gate-layer Mandate stays lean and legacy
    // decision paths (no guardrails/blast radius) are byte-for-byte unchanged.
    ...(guardrails.length ? { guardrails } : {}),
    ...(Object.keys(blastRadius).length ? { blastRadius } : {}),
  };
}

/**
 * Return the full active mandate row (including scope, guardrails, and
 * blast_radius_rules) for UI display or Earn context injection.
 * Returns undefined when no active mandate exists.
 */
export async function getActiveMandateRow(
  supabase: Client,
  orgId?: string,
): Promise<Pick<MandateRow, "auto_approve" | "autonomy_ceiling" | "scope" | "guardrails" | "blast_radius_rules" | "screening_criteria"> | undefined> {
  void orgId;
  const { data } = await supabase
    .from("mandates")
    .select("auto_approve, autonomy_ceiling, scope, guardrails, blast_radius_rules, screening_criteria")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? undefined;
}

/**
 * The active mandate's STRUCTURED screening criteria (mandates.screening_criteria),
 * parsed defensively, or null when there is no active mandate or no usable criteria.
 * This is the machine-readable input the screening/sourcing skills consume — it is
 * kept separate from `getActiveMandate` (the gate-layer shape) so legacy gate paths
 * stay byte-for-byte unchanged. Best-effort: null on any read error, never throws.
 */
export async function getActiveScreeningCriteria(
  supabase: Client,
  orgId?: string,
): Promise<ScreeningCriteria | null> {
  void orgId;
  try {
    const { data } = await supabase
      .from("mandates")
      .select("screening_criteria")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return parseScreeningCriteria((data as { screening_criteria?: unknown } | null)?.screening_criteria ?? null);
  } catch {
    return null;
  }
}

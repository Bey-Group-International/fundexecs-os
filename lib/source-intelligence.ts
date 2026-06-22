// lib/source-intelligence.ts
// The context + learning layer for the Source hub. The engine (lib/source-ai.ts)
// is deliberately DB-free; this module is its DB-aware counterpart. It does two
// things:
//
//   1. ASSEMBLE  — build an OperatorContext for a request: who's asking
//      (user-aware), what's recently moved/stalled in the pipeline and what the
//      firm already holds (context-aware), and a distilled digest of what THIS
//      operator has historically accepted vs skipped (continually learning).
//
//   2. RECORD    — append accept / reject / queue signals to source_feedback
//      (migration 0038). Those rows are what the digest in (1) is built from, so
//      every interaction sharpens the next suggestion. In-context learning, no
//      model fine-tuning.
//
// All reads are best-effort: context is an enhancement, never a dependency, so a
// failed read degrades to "no context" rather than breaking the sourcing flow.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, MemberRole } from "@/lib/supabase/database.types";
import { sourceConfigFor, type OperatorContext } from "@/lib/source-ai";

type Client = SupabaseClient<Database>;

const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// RECORD — append learning signals
// ---------------------------------------------------------------------------
export interface SourceFeedbackInput {
  organizationId: string;
  principalId: string | null;
  module: string; // full key, e.g. "source/lp_pipeline"
  agent?: string | null;
  signal: "accepted" | "rejected" | "queued";
  subjectName: string;
  category?: string | null;
  rationale?: string | null;
  sourceQuery?: string | null;
  fitScore?: number | null;
  action?: string | null;
  recordId?: string | null;
  taskId?: string | null;
  sessionId?: string | null;
}

/**
 * Append one or more learning signals to source_feedback. Best-effort: a write
 * failure is swallowed so recording feedback never breaks the action that
 * produced it. Returns the number of rows inserted (0 on failure / no input).
 */
export async function recordSourceFeedback(
  supabase: Client,
  inputs: SourceFeedbackInput[],
): Promise<number> {
  const rows = inputs
    .filter((i) => i.subjectName?.trim())
    .map((i) => ({
      organization_id: i.organizationId,
      principal_id: i.principalId,
      module: i.module,
      agent: i.agent ?? null,
      signal: i.signal,
      subject_name: i.subjectName.trim().slice(0, 160),
      category: i.category?.trim().slice(0, 80) ?? null,
      rationale: i.rationale?.trim().slice(0, 400) ?? null,
      source_query: i.sourceQuery?.trim().slice(0, 500) ?? null,
      fit_score: typeof i.fitScore === "number" ? Math.round(i.fitScore) : null,
      action: i.action ?? null,
      record_id: i.recordId ?? null,
      task_id: i.taskId ?? null,
      session_id: i.sessionId ?? null,
    }));
  if (rows.length === 0) return 0;
  try {
    const { error } = await supabase.from("source_feedback").insert(rows);
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Pure summarizers — deterministic, unit-testable, no DB
// ---------------------------------------------------------------------------
interface FeedbackLite {
  signal: string;
  category: string | null;
  subject_name: string;
  action: string | null;
}

function topCounts(values: (string | null | undefined)[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const k = (v ?? "").trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k.replace(/_/g, " "));
}

/**
 * Distill recent feedback into a one-line preference digest. Returns "" when
 * there's nothing meaningful to say (so the prompt block stays empty for new
 * operators rather than carrying noise).
 */
export function summarizeFeedback(rows: FeedbackLite[]): string {
  if (!rows.length) return "";
  const accepted = rows.filter((r) => r.signal === "accepted");
  const rejected = rows.filter((r) => r.signal === "rejected");
  const queued = rows.filter((r) => r.signal === "queued");

  const parts: string[] = [];
  const favored = topCounts(accepted.map((r) => r.category), 3);
  if (favored.length) parts.push(`favors ${favored.join(", ")}`);
  const skipped = topCounts(rejected.map((r) => r.category), 2);
  if (skipped.length) parts.push(`tends to skip ${skipped.join(", ")}`);
  const actions = topCounts(queued.map((r) => r.action), 2);
  if (actions.length) parts.push(`usually queues ${actions.join(", ")}`);
  const recent = accepted.slice(0, 4).map((r) => r.subject_name).filter(Boolean);
  if (recent.length) parts.push(`recently accepted ${recent.join(", ")}`);

  return parts.join("; ");
}

interface ActivityInput {
  recentAdds: number;
  recentNames: string[];
  stalledNames: string[];
}

export function summarizeActivity({ recentAdds, recentNames, stalledNames }: ActivityInput): string {
  const parts: string[] = [];
  if (recentAdds > 0) {
    const sample = recentNames.slice(0, 3).join(", ");
    parts.push(`${recentAdds} added recently${sample ? ` (${sample})` : ""}`);
  }
  if (stalledNames.length) {
    parts.push(`${stalledNames.length} stalling (${stalledNames.slice(0, 3).join(", ")})`);
  }
  return parts.join("; ");
}

interface PortfolioInput {
  deals: number;
  owned: number;
  dealNames: string[];
}

export function summarizePortfolio({ deals, owned, dealNames }: PortfolioInput): string {
  if (deals <= 0) return "";
  const sample = dealNames.slice(0, 3).join(", ");
  const ownedClause = owned > 0 ? `, ${owned} owned` : "";
  return `firm tracks ${deals} deal${deals === 1 ? "" : "s"}${ownedClause}${sample ? ` (${sample})` : ""}`;
}

export function summarizeUser(name: string | null, title: string | null, role: MemberRole | null): string {
  const who = (name ?? "").trim();
  const what = [title?.trim(), role ? `${role}` : null].filter(Boolean).join(", ");
  if (!who && !what) return "";
  return [who || "Operator", what ? `(${what})` : ""].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// DB readers — each best-effort, returning a distilled string (or undefined)
// ---------------------------------------------------------------------------

/** Per-user (then org-wide) learned-preference digest for a module, or undefined. */
export async function getLearnedPreferences(
  supabase: Client,
  orgId: string,
  principalId: string | null,
  module?: string,
): Promise<string | undefined> {
  try {
    let q = supabase
      .from("source_feedback")
      .select("signal, category, subject_name, action, principal_id")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(120);
    if (module) q = q.eq("module", module);
    const { data } = await q;
    const all = (data ?? []) as (FeedbackLite & { principal_id: string | null })[];
    if (!all.length) return undefined;
    // Prefer the current operator's own signal; fall back to org-wide if they're
    // new to this module so suggestions aren't cold for first-time users.
    const mine = principalId ? all.filter((r) => r.principal_id === principalId) : [];
    const digest = summarizeFeedback(mine.length >= 3 ? mine : all);
    return digest || undefined;
  } catch {
    return undefined;
  }
}

/** Recent additions + stalls for a module's backing table, or undefined. */
export async function getRecentActivity(
  supabase: Client,
  orgId: string,
  module: string,
): Promise<string | undefined> {
  const cfg = sourceConfigFor(module);
  if (!cfg) return undefined;
  try {
    const { data } = await supabase
      .from(cfg.table as "investors")
      .select("name, created_at, updated_at")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(60);
    const rows = (data ?? []) as unknown as { name: string; created_at: string; updated_at: string }[];
    if (!rows.length) return undefined;
    const now = Date.now();
    const recent = rows.filter((r) => now - new Date(r.created_at).getTime() < 14 * DAY);
    const stalled = rows.filter((r) => now - new Date(r.updated_at).getTime() > 30 * DAY);
    const summary = summarizeActivity({
      recentAdds: recent.length,
      recentNames: recent.map((r) => r.name).filter(Boolean),
      stalledNames: stalled.map((r) => r.name).filter(Boolean),
    });
    return summary || undefined;
  } catch {
    return undefined;
  }
}

/** Cross-hub portfolio state (deals + owned), or undefined. */
export async function getPortfolioContext(supabase: Client, orgId: string): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from("deals")
      .select("name, stage")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(100);
    const rows = (data ?? []) as { name: string; stage: string | null }[];
    if (!rows.length) return undefined;
    const owned = rows.filter((r) => r.stage === "owned").length;
    const summary = summarizePortfolio({
      deals: rows.length,
      owned,
      dealNames: rows.map((r) => r.name).filter(Boolean),
    });
    return summary || undefined;
  } catch {
    return undefined;
  }
}

/** The current operator's identity + role, or undefined. */
export async function getUserContext(
  supabase: Client,
  principalId: string,
  role: MemberRole | null,
): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from("principals")
      .select("full_name, title")
      .eq("id", principalId)
      .maybeSingle();
    const summary = summarizeUser(data?.full_name ?? null, data?.title ?? null, role);
    return summary || undefined;
  } catch {
    return summarizeUser(null, null, role) || undefined;
  }
}

// ---------------------------------------------------------------------------
// ASSEMBLE — the one call the server actions use
// ---------------------------------------------------------------------------
export interface BuildContextArgs {
  orgId: string;
  principalId: string;
  role: MemberRole | null;
  /** When known, scopes activity + learned signal to one module. */
  module?: string;
}

/**
 * Assemble the full OperatorContext for a Source request. All four signals are
 * gathered in parallel and each degrades to undefined independently, so partial
 * data still personalizes what it can.
 */
export async function buildOperatorContext(
  supabase: Client,
  { orgId, principalId, role, module }: BuildContextArgs,
): Promise<OperatorContext> {
  const [user, portfolio, activity, learned] = await Promise.all([
    getUserContext(supabase, principalId, role),
    getPortfolioContext(supabase, orgId),
    module ? getRecentActivity(supabase, orgId, module) : Promise.resolve(undefined),
    getLearnedPreferences(supabase, orgId, principalId, module),
  ]);
  return { user, portfolio, activity, learned };
}

/** True when the context carries a learned-preference digest (drives the UI chip). */
export function isPersonalized(ctx: OperatorContext): boolean {
  return Boolean(ctx.learned);
}

export const __test = {
  summarizeFeedback,
  summarizeActivity,
  summarizePortfolio,
  summarizeUser,
  topCounts,
};

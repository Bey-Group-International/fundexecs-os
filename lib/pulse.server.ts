// lib/pulse.server.ts
// Market Pulse — the DB/model half. One run = one web-search-backed Claude call
// for one org, bounded by the daily search cap and paid for in credits:
//
//   cap check → mandate → credit pre-flight → search → dedupe → insert → meter
//
// Every query is scoped to an explicit organization_id: the sweep runs on the
// service-role client (no RLS), and a manual Refresh runs on the same path after
// the caller's org has been resolved from their session. Pure logic (prompt,
// parsing, budget) lives in lib/pulse.ts.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicClient, LONG_RUN_TIMEOUT_MS } from "@/lib/anthropic-client";
import { spendCredits } from "@/lib/credits";
import { earnWebSearchEnabled, webSearchCount, webSearchTool, WEB_SEARCH_CREDIT_COST } from "@/lib/earn-web-search";
import { EntityDedupe } from "@/lib/source-identity";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";
import type { Database, InvestmentThesis, PulseItem } from "@/lib/supabase/database.types";
import {
  alertCopy,
  digestCopy,
  digestEmailHtml,
  planNotices,
  hasSearchableMandate,
  normalizeFindings,
  parseJsonArray,
  pulseSystemPrompt,
  pulseUserPrompt,
  remainingSearches,
  sweepIsDue,
  PULSE_MAX_ORGS_PER_SWEEP,
  PULSE_RUN_COST,
  type PulseMandate,
} from "@/lib/pulse";

type Client = SupabaseClient<Database>;

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PulseRunResult {
  status: "ok" | "skipped" | "failed";
  detail: string | null;
  items: number;
  searches: number;
}

async function recordRun(
  client: Client,
  orgId: string,
  run: { id?: string; trigger: "sweep" | "manual"; startedBy: string | null } & PulseRunResult,
): Promise<PulseRunResult> {
  await client
    .from("pulse_runs")
    .insert({
      ...(run.id ? { id: run.id } : {}),
      organization_id: orgId,
      trigger: run.trigger,
      status: run.status,
      detail: run.detail,
      searches: run.searches,
      items_found: run.items,
      started_by: run.startedBy,
    })
    .then(undefined, () => {});
  return { status: run.status, detail: run.detail, items: run.items, searches: run.searches };
}

/** Searches this org has spent on Pulse in the last 24 hours. */
export async function pulseSearchesLast24h(client: Client, orgId: string, now = new Date()): Promise<number> {
  const { data } = await client
    .from("pulse_runs")
    .select("searches")
    .eq("organization_id", orgId)
    .gte("created_at", new Date(now.getTime() - DAY_MS).toISOString());
  return (data ?? []).reduce((s, r) => s + ((r as { searches: number }).searches ?? 0), 0);
}

async function loadMandate(client: Client, orgId: string): Promise<PulseMandate> {
  const [thesisRes, mandateRes] = await Promise.all([
    client
      .from("investment_theses")
      .select("title, summary, asset_classes, geographies, check_size_min, check_size_max, target_irr, target_moic, is_active")
      .eq("organization_id", orgId)
      .order("is_active", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("mandates")
      .select("scope")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    thesis: (thesisRes.data as PulseMandate["thesis"] & Pick<InvestmentThesis, "is_active">) ?? null,
    scope: ((mandateRes.data as { scope?: string | null } | null)?.scope ?? null) || null,
  };
}

async function knownNames(client: Client, orgId: string): Promise<{ names: string[]; dismissed: string[] }> {
  const [deals, investors, items] = await Promise.all([
    client.from("deals").select("name").eq("organization_id", orgId).order("updated_at", { ascending: false }).limit(200),
    client.from("investors").select("name").eq("organization_id", orgId).order("updated_at", { ascending: false }).limit(200),
    client
      .from("pulse_items")
      .select("entity_name, headline, status")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  const rows = (items.data ?? []) as Pick<PulseItem, "entity_name" | "headline" | "status">[];
  return {
    names: [
      ...((deals.data ?? []) as { name: string }[]).map((d) => d.name),
      ...((investors.data ?? []) as { name: string }[]).map((i) => i.name),
      ...rows.map((r) => r.entity_name),
    ],
    dismissed: rows.filter((r) => r.status === "dismissed").map((r) => r.headline),
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Run Market Pulse once for one org. Never throws: every outcome, including
 * a skip (cap reached, no mandate, out of credits) or a failure, is recorded in
 * pulse_runs and returned.
 */
export async function runPulseForOrg(
  client: Client,
  orgId: string,
  opts: { trigger: "sweep" | "manual"; startedBy?: string | null; now?: Date },
): Promise<PulseRunResult> {
  const now = opts.now ?? new Date();
  const base = { trigger: opts.trigger, startedBy: opts.startedBy ?? null };
  const skip = (detail: string) => recordRun(client, orgId, { ...base, status: "skipped", detail, items: 0, searches: 0 });

  try {
    if (!earnWebSearchEnabled()) return await skip("Live web search is not enabled for this workspace.");

    const remaining = remainingSearches(await pulseSearchesLast24h(client, orgId, now));
    if (remaining === 0) return await skip("Today's web search allowance is used up — Pulse refreshes tomorrow.");

    const mandate = await loadMandate(client, orgId);
    if (!hasSearchableMandate(mandate)) {
      return await skip("Add an investment thesis or mandate so Pulse knows what to look for.");
    }

    let spent: Awaited<ReturnType<typeof spendCredits>>;
    try {
      spent = await spendCredits(orgId, PULSE_RUN_COST, "pulse");
    } catch (e) {
      console.error("[pulse] credit check failed", orgId, e);
      return await recordRun(client, orgId, { ...base, status: "failed", detail: "Credit check unavailable.", items: 0, searches: 0 });
    }
    if (!spent.ok) return await skip("Not enough credits to run Pulse.");

    const { names, dismissed } = await knownNames(client, orgId);
    const anthropic = anthropicClient(process.env.ANTHROPIC_API_KEY, LONG_RUN_TIMEOUT_MS);
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: pulseSystemPrompt(),
      tools: [webSearchTool(MODEL, remaining)],
      messages: [{ role: "user", content: pulseUserPrompt({ mandate, existingNames: names, dismissedHeadlines: dismissed, today: now }) }],
    });

    const searches = webSearchCount(message);
    if (searches > 0) {
      void spendCredits(orgId, searches * WEB_SEARCH_CREDIT_COST, "pulse_web_search").catch((err) => {
        console.error("[pulse] web search credit debit failed", orgId, err);
      });
    }

    const findings = normalizeFindings(parseJsonArray(textOf(message)) ?? [], names);
    const runId = crypto.randomUUID();
    let inserted: PulseItem[] = [];
    if (findings.length) {
      const { data, error } = await client
        .from("pulse_items")
        .upsert(
          findings.map((f) => ({ ...f, organization_id: orgId, run_id: runId })),
          { onConflict: "organization_id,dedupe_key", ignoreDuplicates: true },
        )
        .select("*");
      if (error) console.error("[pulse] insert failed", orgId, error.message);
      inserted = (data ?? []) as PulseItem[];
    }
    // The daily sweep tells the team what it found; a manual Refresh doesn't,
    // because whoever pressed it is already looking at the page.
    if (opts.trigger === "sweep" && inserted.length) {
      await deliverPulseNotices(client, orgId, inserted).catch((e) => console.error("[pulse] notices failed", orgId, e));
    }
    return await recordRun(client, orgId, { ...base, id: runId, status: "ok", detail: null, items: inserted.length, searches });
  } catch (e) {
    console.error("[pulse] run failed", orgId, e);
    return await recordRun(client, orgId, { ...base, status: "failed", detail: "Pulse couldn't complete this run.", items: 0, searches: 0 });
  }
}

/**
 * Orgs due for their daily sweep: they have an investment thesis or an active
 * mandate, and no sweep run (of any outcome) in the last 24 hours. Capped per
 * pass so the hourly cron spreads orgs across the day.
 */
export async function findDuePulseOrgs(client: Client, now: Date, limit = PULSE_MAX_ORGS_PER_SWEEP): Promise<string[]> {
  if (!earnWebSearchEnabled()) return [];
  const [theses, mandates, runs] = await Promise.all([
    client.from("investment_theses").select("organization_id").limit(1000),
    client.from("mandates").select("organization_id").eq("is_active", true).limit(1000),
    client
      .from("pulse_runs")
      .select("organization_id, created_at")
      .eq("trigger", "sweep")
      .gte("created_at", new Date(now.getTime() - DAY_MS).toISOString())
      .limit(5000),
  ]);
  const lastSweep = new Map<string, string>();
  for (const r of (runs.data ?? []) as { organization_id: string; created_at: string }[]) {
    const prev = lastSweep.get(r.organization_id);
    if (!prev || r.created_at > prev) lastSweep.set(r.organization_id, r.created_at);
  }
  const candidates = new Set<string>();
  for (const r of [...((theses.data ?? []) as { organization_id: string }[]), ...((mandates.data ?? []) as { organization_id: string }[])]) {
    if (r.organization_id) candidates.add(r.organization_id);
  }
  return [...candidates].filter((org) => sweepIsDue(lastSweep.get(org), now)).slice(0, limit);
}

export type AddToPipelineResult =
  | { ok: true; recordType: "deal" | "investor"; recordId: string; existed: boolean }
  | { ok: false; error: string };

/**
 * Turn a Pulse item into a pipeline record: a Deal for deals and investments,
 * an Investor (LP pipeline) for investors. A name the firm already tracks is
 * linked rather than duplicated. Runs on the caller's RLS-scoped client.
 */
export async function addPulseItemToPipeline(
  client: Client,
  orgId: string,
  userId: string,
  itemId: string,
): Promise<AddToPipelineResult> {
  const { data } = await client.from("pulse_items").select("*").eq("id", itemId).eq("organization_id", orgId).maybeSingle();
  const item = data as PulseItem | null;
  if (!item) return { ok: false, error: "That Pulse item no longer exists." };
  if (item.status === "added" && item.added_record_type && item.added_record_id) {
    return { ok: true, recordType: item.added_record_type, recordId: item.added_record_id, existed: true };
  }

  const recordType = item.kind === "investor" ? "investor" : "deal";
  const table = recordType === "investor" ? "investors" : "deals";
  const notes = [
    item.headline,
    item.take,
    item.why_it_fits ? `Why it fits: ${item.why_it_fits}` : null,
    item.source_url ? `Source: ${item.source_url}` : null,
    "Added from Market Pulse.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { data: existing } = await client.from(table).select("id, name").eq("organization_id", orgId).limit(500);
  const match = ((existing ?? []) as { id: string; name: string }[]).find((r) => new EntityDedupe([r.name]).has(item.entity_name));

  let recordId: string;
  let existed = false;
  if (match) {
    recordId = match.id;
    existed = true;
  } else if (recordType === "deal") {
    const { data: row, error } = await client
      .from("deals")
      .insert({
        organization_id: orgId,
        name: item.entity_name,
        stage: "sourced",
        source: "Market Pulse",
        url_source: item.source_url,
        notes,
        provenance: "ai",
      })
      .select("id")
      .single();
    if (error || !row) return { ok: false, error: error?.message ?? "Couldn't create the deal." };
    recordId = (row as { id: string }).id;
  } else {
    const { data: row, error } = await client
      .from("investors")
      .insert({
        organization_id: orgId,
        name: item.entity_name,
        investor_type: "other",
        pipeline_stage: "prospect",
        url_source: item.source_url,
        notes,
        provenance: "ai",
      })
      .select("id")
      .single();
    if (error || !row) return { ok: false, error: error?.message ?? "Couldn't create the investor." };
    recordId = (row as { id: string }).id;
  }

  await client
    .from("pulse_items")
    .update({
      status: "added",
      added_record_type: recordType,
      added_record_id: recordId,
      acted_by: userId,
      acted_at: new Date().toISOString(),
    })
    .eq("id", item.id)
    .eq("organization_id", orgId);

  return { ok: true, recordType, recordId, existed };
}

async function postInboxThread(
  client: Client,
  orgId: string,
  copy: { subject: string; preview: string; body: string },
  priority: number,
): Promise<void> {
  const { data, error } = await client
    .from("inbox_threads")
    .insert({
      organization_id: orgId,
      channel: "pulse",
      category: "messaging",
      subject: copy.subject,
      preview: copy.preview,
      intent: "Market Pulse",
      ai_summary: copy.preview,
      priority,
      status: "open",
      unread: true,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return;
  await client.from("inbox_messages").insert({
    organization_id: orgId,
    thread_id: (data as { id: string }).id,
    direction: "inbound",
    author: "Market Pulse",
    body: copy.body,
  });
}

/**
 * After a sweep: an Inbox alert for each high-fit find, one digest of the best
 * of the rest, and — where the org has a mailbox connected — the digest by
 * email to each member. Best-effort throughout.
 */
async function deliverPulseNotices(client: Client, orgId: string, inserted: PulseItem[]): Promise<void> {
  const { alerts, digest } = planNotices(inserted);
  for (const a of alerts) await postInboxThread(client, orgId, alertCopy(a), 90);

  const copy = digestCopy(digest, inserted.length);
  if (!copy) return;
  await postInboxThread(client, orgId, copy, 60);

  const { data: members } = await client
    .from("organization_members")
    .select("principal_id")
    .eq("organization_id", orgId)
    .limit(50);
  const ids = ((members ?? []) as { principal_id: string }[]).map((m) => m.principal_id);
  if (!ids.length) return;
  const { data: people } = await client.from("principals").select("email, full_name").in("id", ids);
  const html = digestEmailHtml([...alerts, ...digest].slice(0, 5), inserted.length, `${SITE_URL}/pulse`);
  for (const p of (people ?? []) as { email: string | null; full_name: string | null }[]) {
    if (!p.email) continue;
    // Without a connected mailbox sendEmail returns ok:false and sends nothing.
    const r = await sendEmail({ to: { name: p.full_name ?? p.email, email: p.email }, subject: copy.subject, htmlBody: html, orgId });
    if (!r.ok) break;
  }
}

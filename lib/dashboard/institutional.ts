import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, CapitalEventType, DealStage } from "@/lib/supabase/database.types";

// The institutional dashboard aggregator. Reads every live system of record —
// capital, deals, portfolio, finance, documents, comms, network, automation —
// and shapes them into the headline KPIs, the two anchor panels (Capital & LPs,
// Deals & Portfolio), a systems-of-record status grid, and one unified live
// activity feed merged across the whole operating surface. All reads are
// org-scoped by RLS; explicit `organization_id` filters are added for count
// queries and clarity. Pure data — presentation lives in the components.

type Client = SupabaseClient<Database>;

export interface KpiMetric {
  key: string;
  label: string;
  value: string;
  sub?: string;
  href: string;
  tone: "gold" | "neural" | "success" | "muted";
}

export type SystemHealth = "live" | "steady" | "empty";

export interface SystemStatus {
  key: string;
  label: string;
  primary: string;
  unit: string;
  detail: string | null;
  health: SystemHealth;
  lastActivity: string | null;
  href: string;
}

export type ActivityKind =
  | "capital"
  | "deal"
  | "ic"
  | "valuation"
  | "dispatch"
  | "envelope"
  | "task"
  | "approval";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string | null;
  href: string;
  at: string;
}

export interface CapitalPanelData {
  committed: number;
  called: number;
  distributed: number;
  dpi: number | null;
  investorCount: number;
  fundCount: number;
  byStage: { stage: string; count: number }[];
  recentEvents: { id: string; type: CapitalEventType; amount: number; date: string }[];
}

export interface PortfolioPanelData {
  pipelineValue: number;
  dealCount: number;
  byStage: { stage: DealStage; count: number }[];
  diligenceOpen: number;
  icRecent: number;
  portfolioNav: number;
  assetCount: number;
  recentMarks: { id: string; assetName: string; value: number; asOf: string }[];
}

export interface InstitutionalDashboard {
  kpis: KpiMetric[];
  capital: CapitalPanelData;
  portfolio: PortfolioPanelData;
  systems: SystemStatus[];
  activity: ActivityItem[];
}

const DEAL_STAGES: DealStage[] = ["sourced", "screening", "diligence", "ic_review", "closing"];
const OPEN_DILIGENCE = new Set(["open", "in_review", "flagged"]);
const ACTIVE_TASKS = new Set(["pending", "in_progress", "awaiting_approval", "blocked"]);
const ENVELOPE_SETTLED = new Set(["completed", "voided", "declined", "cancelled"]);

const DAY_MS = 86_400_000;

function sum(nums: (number | null | undefined)[]): number {
  return nums.reduce<number>((acc, n) => acc + (n ?? 0), 0);
}

function compactUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function health(lastActivity: string | null, count: number): SystemHealth {
  if (count <= 0) return "empty";
  if (lastActivity && Date.now() - new Date(lastActivity).getTime() <= 14 * DAY_MS) return "live";
  return "steady";
}

function maxIso(...vals: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of vals) {
    if (!v) continue;
    if (!best || new Date(v).getTime() > new Date(best).getTime()) best = v;
  }
  return best;
}

export async function getInstitutionalDashboard(
  supabase: Client,
  orgId: string,
): Promise<InstitutionalDashboard> {
  const [
    fundsRes,
    commitmentsRes,
    investorsRes,
    capitalEventsRes,
    dealsRes,
    diligenceRes,
    icRes,
    assetsRes,
    marksRes,
    tasksRes,
    approvalsRes,
    dispatchRes,
    envelopesRes,
    documentsCountRes,
    inboxOpenRes,
    inboxLatestRes,
    networkCountRes,
    networkLatestRes,
    automationsRes,
    finInvoicesRes,
    finJournalRes,
    meetingsRes,
  ] = await Promise.all([
    supabase.from("funds").select("committed_capital, called_capital, distributed_capital").eq("organization_id", orgId),
    supabase.from("commitments").select("committed_amount, called_amount, distributed_amount").eq("organization_id", orgId),
    supabase.from("investors").select("id, pipeline_stage").eq("organization_id", orgId),
    supabase
      .from("capital_events")
      .select("id, event_type, amount, effective_date, created_at")
      .eq("organization_id", orgId)
      .order("effective_date", { ascending: false })
      .limit(8),
    supabase.from("deals").select("id, name, stage, target_amount, created_at, updated_at").is("archived_at", null).eq("organization_id", orgId),
    supabase.from("diligence_items").select("id, status").eq("organization_id", orgId),
    supabase
      .from("ic_decisions")
      .select("id, deal_id, decision, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase.from("assets").select("id, name, current_value, updated_at, created_at").eq("organization_id", orgId),
    supabase
      .from("valuation_marks")
      .select("id, asset_id, value, as_of, created_at")
      .eq("organization_id", orgId)
      .order("as_of", { ascending: false })
      .limit(8),
    supabase.from("tasks").select("id, title, hub, status, parent_task_id, updated_at, created_at").eq("organization_id", orgId),
    supabase
      .from("approvals")
      .select("id, summary, decision, decided_at, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("dispatch_log")
      .select("id, action, channel, ok, detail, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("envelopes")
      .select("id, title, status, sent_at, completed_at, updated_at, created_at")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(10),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase
      .from("inbox_threads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("status", "open"),
    supabase
      .from("inbox_threads")
      .select("last_message_at")
      .eq("organization_id", orgId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("network_contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase
      .from("network_contacts")
      .select("created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("automations")
      .select("id, enabled, last_run_at")
      .eq("organization_id", orgId),
    supabase
      .from("fin_invoices")
      .select("id, total, amount_paid, status, updated_at")
      .eq("organization_id", orgId)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase
      .from("fin_journal_entries")
      .select("posted_at, entry_date")
      .eq("organization_id", orgId)
      .order("entry_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("live_meetings")
      .select("scheduled_at, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const funds = fundsRes.data ?? [];
  const commitments = commitmentsRes.data ?? [];
  const investors = investorsRes.data ?? [];
  const capitalEvents = capitalEventsRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const diligence = diligenceRes.data ?? [];
  const icDecisions = icRes.data ?? [];
  const assets = assetsRes.data ?? [];
  const marks = marksRes.data ?? [];
  const tasks = tasksRes.data ?? [];
  const approvals = approvalsRes.data ?? [];
  const dispatches = dispatchRes.data ?? [];
  const envelopes = envelopesRes.data ?? [];
  const automations = automationsRes.data ?? [];
  const finInvoices = finInvoicesRes.data ?? [];

  // ---- Capital rollup ---------------------------------------------------
  // Prefer fund-level rollups; fall back to the commitment ledger when no fund
  // records carry totals yet (early-stage orgs enter commitments first).
  const fundCommitted = sum(funds.map((f) => f.committed_capital));
  const fundCalled = sum(funds.map((f) => f.called_capital));
  const fundDistributed = sum(funds.map((f) => f.distributed_capital));
  const committed = fundCommitted || sum(commitments.map((c) => c.committed_amount));
  const called = fundCalled || sum(commitments.map((c) => c.called_amount));
  const distributed = fundDistributed || sum(commitments.map((c) => c.distributed_amount));

  const investorStage = new Map<string, number>();
  for (const inv of investors) {
    const stage = inv.pipeline_stage || "unassigned";
    investorStage.set(stage, (investorStage.get(stage) ?? 0) + 1);
  }

  const capital: CapitalPanelData = {
    committed,
    called,
    distributed,
    dpi: called > 0 ? distributed / called : null,
    investorCount: investors.length,
    fundCount: funds.length,
    byStage: [...investorStage.entries()]
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6),
    recentEvents: capitalEvents.map((e) => ({
      id: e.id,
      type: e.event_type,
      amount: e.amount,
      date: e.effective_date,
    })),
  };

  // ---- Deals & portfolio ------------------------------------------------
  const dealStageCount = new Map<string, number>();
  for (const d of deals) dealStageCount.set(d.stage, (dealStageCount.get(d.stage) ?? 0) + 1);
  const assetName = new Map(assets.map((a) => [a.id, a.name] as const));

  const portfolio: PortfolioPanelData = {
    pipelineValue: sum(deals.map((d) => d.target_amount)),
    dealCount: deals.length,
    byStage: DEAL_STAGES.map((stage) => ({ stage, count: dealStageCount.get(stage) ?? 0 })),
    diligenceOpen: diligence.filter((d) => OPEN_DILIGENCE.has(d.status)).length,
    icRecent: icDecisions.length,
    portfolioNav: sum(assets.map((a) => a.current_value)),
    assetCount: assets.length,
    recentMarks: marks.map((m) => ({
      id: m.id,
      assetName: assetName.get(m.asset_id) ?? "Asset",
      value: m.value,
      asOf: m.as_of,
    })),
  };

  // ---- Headline KPIs ----------------------------------------------------
  const activeWorkflows = tasks.filter((t) => t.parent_task_id === null && ACTIVE_TASKS.has(t.status)).length;
  const pendingApprovals = approvals.filter((a) => a.decision === "pending").length;

  const kpis: KpiMetric[] = [
    { key: "committed", label: "Capital committed", value: compactUsd(committed), sub: `${capital.fundCount} fund${capital.fundCount === 1 ? "" : "s"}`, href: "/execute/capital_events", tone: "gold" },
    { key: "called", label: "Capital called", value: compactUsd(called), sub: committed > 0 ? `${Math.round((called / committed) * 100)}% of committed` : "—", href: "/execute/capital_events", tone: "gold" },
    { key: "pipeline", label: "Pipeline value", value: compactUsd(portfolio.pipelineValue), sub: `${portfolio.dealCount} deal${portfolio.dealCount === 1 ? "" : "s"}`, href: "/source/deal_pipeline", tone: "neural" },
    { key: "nav", label: "Portfolio NAV", value: compactUsd(portfolio.portfolioNav), sub: `${portfolio.assetCount} asset${portfolio.assetCount === 1 ? "" : "s"}`, href: "/execute/asset_management", tone: "neural" },
    { key: "workflows", label: "Active workflows", value: String(activeWorkflows), sub: "in flight", href: "/workspace", tone: "success" },
    { key: "approvals", label: "Pending approvals", value: String(pendingApprovals), sub: pendingApprovals > 0 ? "awaiting sign-off" : "all clear", href: "/grid/review", tone: pendingApprovals > 0 ? "gold" : "muted" },
  ];

  // ---- Systems-of-record status grid ------------------------------------
  const lastCapital = maxIso(...capitalEvents.map((e) => e.created_at));
  const lastDeal = maxIso(...deals.map((d) => d.updated_at ?? d.created_at));
  const lastMark = maxIso(...marks.map((m) => m.created_at));
  const envelopesInFlight = envelopes.filter((e) => !ENVELOPE_SETTLED.has(e.status)).length;
  const lastEnvelope = maxIso(...envelopes.map((e) => e.updated_at));
  const documentsCount = documentsCountRes.count ?? 0;
  const inboxOpen = inboxOpenRes.count ?? 0;
  const inboxLatest = (inboxLatestRes.data as { last_message_at: string | null } | null)?.last_message_at ?? null;
  const networkCount = networkCountRes.count ?? 0;
  const networkLatest = (networkLatestRes.data as { created_at: string | null } | null)?.created_at ?? null;
  const enabledAutomations = automations.filter((a) => a.enabled).length;
  const lastAutomationRun = maxIso(...automations.map((a) => a.last_run_at));
  const openInvoices = finInvoices.filter((i) => i.status !== "paid" && i.status !== "void").length;
  const arOutstanding = sum(finInvoices.map((i) => (i.total ?? 0) - (i.amount_paid ?? 0)));
  const lastFinance = maxIso(
    (finJournalRes.data as { posted_at: string | null; entry_date: string | null } | null)?.posted_at,
    (finJournalRes.data as { posted_at: string | null; entry_date: string | null } | null)?.entry_date,
    ...finInvoices.map((i) => i.updated_at),
  );
  const lastComms = maxIso(
    inboxLatest,
    (meetingsRes.data as { created_at: string | null } | null)?.created_at,
  );

  const systems: SystemStatus[] = [
    {
      key: "capital",
      label: "Capital & LPs",
      primary: String(capital.investorCount),
      unit: "investors",
      detail: `${compactUsd(committed)} committed`,
      health: health(lastCapital, capital.investorCount),
      lastActivity: lastCapital,
      href: "/source/lp_pipeline",
    },
    {
      key: "deals",
      label: "Deal pipeline",
      primary: String(portfolio.dealCount),
      unit: "deals",
      detail: `${portfolio.diligenceOpen} diligence open`,
      health: health(lastDeal, portfolio.dealCount),
      lastActivity: lastDeal,
      href: "/source/deal_pipeline",
    },
    {
      key: "portfolio",
      label: "Portfolio & valuations",
      primary: String(portfolio.assetCount),
      unit: "assets",
      detail: `${compactUsd(portfolio.portfolioNav)} NAV`,
      health: health(maxIso(lastMark, ...assets.map((a) => a.updated_at ?? a.created_at)), portfolio.assetCount),
      lastActivity: maxIso(lastMark, ...assets.map((a) => a.updated_at ?? a.created_at)),
      href: "/execute/asset_management",
    },
    {
      key: "finance",
      label: "Finance & accounting",
      primary: String(openInvoices),
      unit: "open invoices",
      detail: arOutstanding > 0 ? `${compactUsd(arOutstanding)} outstanding` : "books current",
      health: health(lastFinance, finInvoices.length),
      lastActivity: lastFinance,
      href: "/finance",
    },
    {
      key: "documents",
      label: "Documents & signing",
      primary: String(documentsCount),
      unit: "documents",
      detail: envelopesInFlight > 0 ? `${envelopesInFlight} envelope${envelopesInFlight === 1 ? "" : "s"} in flight` : "no envelopes pending",
      health: health(maxIso(lastEnvelope), documentsCount + envelopes.length),
      lastActivity: lastEnvelope,
      href: "/envelopes",
    },
    {
      key: "comms",
      label: "Comms & meetings",
      primary: String(inboxOpen),
      unit: "open threads",
      detail: "inbox + meetings",
      health: health(lastComms, inboxOpen),
      lastActivity: lastComms,
      href: "/inbox",
    },
    {
      key: "network",
      label: "Network & relationships",
      primary: String(networkCount),
      unit: "contacts",
      detail: "relationship capital",
      health: health(networkLatest, networkCount),
      lastActivity: networkLatest,
      href: "/network",
    },
    {
      key: "automation",
      label: "Automation",
      primary: String(enabledAutomations),
      unit: "enabled",
      detail: `${automations.length} configured`,
      health: health(lastAutomationRun, automations.length),
      lastActivity: lastAutomationRun,
      href: "/automations",
    },
  ];

  // ---- Unified live activity feed ---------------------------------------
  const feed: ActivityItem[] = [];

  for (const e of capitalEvents) {
    feed.push({
      id: `cap-${e.id}`,
      kind: "capital",
      title: `${labelCapital(e.event_type)} · ${compactUsd(e.amount)}`,
      detail: "Capital event recorded",
      href: "/execute/capital_events",
      at: e.created_at ?? e.effective_date,
    });
  }
  for (const d of icDecisions) {
    feed.push({
      id: `ic-${d.id}`,
      kind: "ic",
      title: `IC decision · ${String(d.decision).replace(/_/g, " ")}`,
      detail: "Investment committee recorded a decision",
      href: `/deal/${d.deal_id}`,
      at: d.created_at,
    });
  }
  for (const m of marks) {
    feed.push({
      id: `mark-${m.id}`,
      kind: "valuation",
      title: `Valuation mark · ${assetName.get(m.asset_id) ?? "Asset"}`,
      detail: `Marked at ${compactUsd(m.value)}`,
      href: "/execute/valuations",
      at: m.created_at ?? m.as_of,
    });
  }
  for (const d of deals.slice(0, 8)) {
    feed.push({
      id: `deal-${d.id}`,
      kind: "deal",
      title: `Deal · ${d.name}`,
      detail: `Stage: ${String(d.stage).replace(/_/g, " ")}`,
      href: `/deal/${d.id}`,
      at: d.updated_at ?? d.created_at,
    });
  }
  for (const dl of dispatches) {
    feed.push({
      id: `disp-${dl.id}`,
      kind: "dispatch",
      title: `${dl.ok ? "Dispatched" : "Failed"} · ${dl.action}`,
      detail: `via ${dl.channel}${dl.detail ? ` — ${dl.detail}` : ""}`,
      href: "/activity",
      at: dl.created_at,
    });
  }
  for (const en of envelopes.slice(0, 6)) {
    feed.push({
      id: `env-${en.id}`,
      kind: "envelope",
      title: `Envelope ${en.status} · ${en.title}`,
      detail: "E-signature workflow",
      href: "/envelopes",
      at: en.updated_at ?? en.created_at,
    });
  }
  for (const t of tasks
    .filter((t) => t.parent_task_id === null && t.status === "completed")
    .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
    .slice(0, 6)) {
    feed.push({
      id: `task-${t.id}`,
      kind: "task",
      title: `Workflow completed · ${t.title}`,
      detail: t.hub ? `${t.hub} hub` : null,
      href: "/workspace",
      at: t.updated_at ?? t.created_at,
    });
  }
  for (const a of approvals.filter((a) => a.decision !== "pending" && a.decided_at)) {
    feed.push({
      id: `appr-${a.id}`,
      kind: "approval",
      title: `Approval ${a.decision} · ${a.summary.replace(/^Tier\s+[123]\s+—\s+/, "")}`,
      detail: "Gate resolved",
      href: "/grid/review",
      at: a.decided_at ?? a.created_at,
    });
  }

  const activity = feed
    .filter((f) => f.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 20);

  return { kpis, capital, portfolio, systems, activity };
}

// Compact relative time for the activity feed and system cards — finer-grained
// than the marketplace day-only variant (surfaces minutes/hours for a live feel).
export function relTime(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const diff = now - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function labelCapital(type: CapitalEventType): string {
  const map: Record<CapitalEventType, string> = {
    capital_call: "Capital call",
    distribution: "Distribution",
    contribution: "Contribution",
    fee: "Fee",
    return_of_capital: "Return of capital",
    carry: "Carry",
  };
  return map[type] ?? type;
}

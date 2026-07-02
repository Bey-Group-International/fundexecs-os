// lib/inbox.ts
// The notifications inbox: one aggregated, org-scoped view of everything that
// needs the operator's attention — pending approvals, overdue diligence,
// IC-ready deals, and open critical/high risks. The Run hub turns evaluation
// work into conviction; the inbox turns that conviction (plus the workflow
// approval queue) into a short, actionable list with a deep link per item.
//
// I/O lives in `getInbox` / `getInboxCount`; the shaping and counting is kept in
// pure, side-effect-free helpers (`inboxTotal`, `dealToIcReadyItem`,
// `isInboxOverdue`, …) so they unit-test without a DB or server-only imports.
import * as React from "react";
import { createServerClient } from "@/lib/supabase/server";
import { getRunConviction } from "@/lib/run-conviction";
import { isOverdue } from "@/lib/diligence-templates";
import type { DealConviction } from "@/lib/run-conviction";
import type { Deal, DiligenceItem, Task } from "@/lib/supabase/database.types";

// React's per-request `cache` is provided by the Next.js runtime; fall back to
// an identity wrapper outside it (e.g. unit tests) so this module loads anywhere.
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof React.cache === "function" ? React.cache : (fn) => fn;

// --- Shapes -----------------------------------------------------------------

/** The visual weight / accent color an inbox row carries. */
export type InboxTone = "approval" | "overdue" | "ready" | "risk";

/** A single actionable line in the inbox. */
export interface InboxItem {
  /** Stable, unique within its group (and across the inbox). */
  id: string;
  kind: InboxTone;
  title: string;
  subtitle: string;
  /** Where clicking the row takes the operator. */
  href: string;
  tone: InboxTone;
}

/** The inbox, grouped by the kind of action required. */
export interface Inbox {
  needsApproval: InboxItem[];
  overdueDiligence: InboxItem[];
  icReady: InboxItem[];
  openRisks: InboxItem[];
}

export const EMPTY_INBOX: Inbox = {
  needsApproval: [],
  overdueDiligence: [],
  icReady: [],
  openRisks: [],
};

// --- Pure helpers (unit-tested) ---------------------------------------------

/** Total number of actionable items across every group. */
export function inboxTotal(inbox: Inbox): number {
  return (
    inbox.needsApproval.length +
    inbox.overdueDiligence.length +
    inbox.icReady.length +
    inbox.openRisks.length
  );
}

/** True when nothing in the inbox needs the operator. */
export function isInboxEmpty(inbox: Inbox): boolean {
  return inboxTotal(inbox) === 0;
}

/**
 * Overdue predicate for the inbox: an item is overdue when it has a due_date
 * strictly before `todayIso` and is still open. Delegates to the shared
 * diligence helper so the two never drift apart.
 */
export function isInboxOverdue(
  item: Pick<DiligenceItem, "due_date" | "status">,
  todayIso: string,
): boolean {
  return isOverdue(item, todayIso);
}

/** A workflow awaiting approval → an inbox row linking to its session. */
export function workflowToApprovalItem(
  task: Pick<Task, "id" | "title" | "session_id" | "assigned_agent" | "description">,
): InboxItem {
  const agentName = task.assigned_agent ? String(task.assigned_agent).replace(/_/g, " ") : null;
  const subtitle = agentName
    ? `Raised by ${agentName} · awaiting your approval`
    : "Workflow awaiting your approval";
  // Deep-link priority: session → description path → workspace fallback.
  // Marketplace interest tasks encode the listing path in description.
  const descPath = task.description?.trim();
  const href = task.session_id
    ? `/session/${task.session_id}`
    : descPath?.startsWith("/")
      ? descPath
      : "/workspace";
  return {
    id: `approval:${task.id}`,
    kind: "approval",
    title: task.title,
    subtitle,
    href,
    tone: "approval",
  };
}

/** An overdue diligence item → an inbox row linking to its deal war-room. */
export function diligenceToOverdueItem(
  item: Pick<DiligenceItem, "id" | "title" | "category" | "due_date" | "deal_id">,
  dealName: string | null,
): InboxItem {
  const where = dealName ?? "this deal";
  const due = item.due_date ? ` · due ${item.due_date}` : "";
  return {
    id: `overdue:${item.id}`,
    kind: "overdue",
    title: item.title,
    subtitle: `Overdue on ${where}${due}`,
    href: `/deal/${item.deal_id}`,
    tone: "overdue",
  };
}

/** An IC-ready deal → an inbox row linking to its war-room. */
export function dealToIcReadyItem(deal: Pick<Deal, "id" | "name">): InboxItem {
  return {
    id: `ic-ready:${deal.id}`,
    kind: "ready",
    title: deal.name,
    subtitle: "Ready for Investment Committee",
    href: `/deal/${deal.id}`,
    tone: "ready",
  };
}

/** An open high/critical finding → an inbox row linking to its deal war-room. */
export function riskToInboxItem(
  item: Pick<DiligenceItem, "id" | "title" | "finding" | "deal_id">,
  dealName: string | null,
): InboxItem {
  const where = dealName ?? "this deal";
  const detail = item.finding?.trim();
  return {
    id: `risk:${item.id}`,
    kind: "risk",
    title: item.title,
    subtitle: detail ? `${where} — ${detail}` : `Open critical risk on ${where}`,
    href: `/deal/${item.deal_id}`,
    tone: "risk",
  };
}

/**
 * Pure roll-up: assemble the inbox from the run-conviction working set, the
 * awaiting-approval workflows, and today's date. No I/O — kept separate from the
 * fetch so the grouping is unit-testable with in-memory fixtures.
 */
export function buildInbox(
  deals: DealConviction[],
  awaitingApproval: Pick<Task, "id" | "title" | "session_id" | "assigned_agent" | "description">[],
  todayIso: string,
): Inbox {
  const dealName = new Map<string, string>();
  for (const d of deals) dealName.set(d.deal.id, d.deal.name);

  const needsApproval = awaitingApproval.map(workflowToApprovalItem);

  const overdueDiligence: InboxItem[] = [];
  for (const d of deals) {
    for (const item of d.diligence) {
      if (isInboxOverdue(item, todayIso)) {
        overdueDiligence.push(diligenceToOverdueItem(item, dealName.get(item.deal_id) ?? d.deal.name));
      }
    }
  }

  const icReady = deals
    .filter((d) => d.stage.key === "ic_ready")
    .map((d) => dealToIcReadyItem(d.deal));

  const openRisks: InboxItem[] = [];
  for (const d of deals) {
    for (const risk of d.openRisks) {
      openRisks.push(riskToInboxItem(risk, dealName.get(risk.deal_id) ?? d.deal.name));
    }
  }

  return { needsApproval, overdueDiligence, icReady, openRisks };
}

// --- I/O --------------------------------------------------------------------

/**
 * Fetch the awaiting-approval workflows for an org: top-level tasks (no parent)
 * whose status gates on a human decision. Returns the lightweight shape the
 * inbox needs.
 */
async function fetchAwaitingApproval(
  orgId: string,
): Promise<Pick<Task, "id" | "title" | "session_id" | "assigned_agent" | "description">[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("tasks")
    .select("id, title, session_id, assigned_agent, description")
    .eq("organization_id", orgId)
    .is("parent_task_id", null)
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: false });
  const rows = (data ?? []) as Pick<Task, "id" | "title" | "session_id" | "assigned_agent" | "description">[];
  // Deduplicate by title — multiple pending approvals with identical titles
  // are the same logical action queued more than once. Keep the most recent.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = (r.title ?? "").trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Build the operator's inbox for an org. Pulls the run-conviction working set
 * (deals, diligence, open risks, IC-ready stage) and the awaiting-approval
 * workflow queue in parallel, then hands off to the pure roll-up.
 *
 * Best-effort: any failure degrades to an empty inbox rather than breaking the
 * page. Memoized per request so the page body and a top-bar badge share queries.
 */
export const getInbox = cache(async function getInbox(orgId: string): Promise<Inbox> {
  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const [conviction, awaitingApproval] = await Promise.all([
      getRunConviction(orgId),
      fetchAwaitingApproval(orgId),
    ]);
    return buildInbox(conviction.deals, awaitingApproval, todayIso);
  } catch {
    return EMPTY_INBOX;
  }
});

/**
 * The total count of actionable inbox items for an org — what a top-bar bell
 * badge renders. Shares the memoized `getInbox` query set, so calling both in a
 * request is cheap.
 */
export async function getInboxCount(orgId: string): Promise<number> {
  try {
    return inboxTotal(await getInbox(orgId));
  } catch {
    return 0;
  }
}

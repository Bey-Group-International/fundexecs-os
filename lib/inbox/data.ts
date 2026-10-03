// lib/inbox/data.ts
// The read path for the Unified Inbox. Loads an org's threads ranked hottest-
// first (priority desc, then most-recent activity) and resolves each thread's
// deep link — the deal or investor it concerns — into a name + href so an inbox
// item always opens straight into its Command Center context. Best-effort: any
// read failure degrades to an empty list rather than breaking the page.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InboxChannel, InboxThread } from "@/lib/supabase/database.types";
import {
  computePriority,
  summarizeThread as defaultSummarize,
  type ThreadDigestInput,
  type ThreadSummary,
} from "@/lib/inbox/intelligence";
import { recordThreadOnTimeline } from "@/lib/inbox/crm-activity.server";
import { draftsFirst, missingDraftThreadIds, type ThreadDraft } from "@/lib/inbox/drafts";
import { readThreadDrafts } from "@/lib/inbox/drafts.server";

export interface ThreadContext {
  kind: "deal" | "investor";
  id: string;
  name: string;
  href: string;
}

/** The meeting a thread came out of — its follow-up — with a link to the report. */
export interface ThreadMeeting {
  id: string;
  title: string;
  href: string;
}

export interface ThreadAssignee {
  id: string;
  name: string;
}

export interface InboxThreadView {
  thread: InboxThread;
  context: ThreadContext | null;
  // The teammate the thread is routed to, resolved to a name; null if unassigned.
  assignee: ThreadAssignee | null;
  /** The meeting this thread is the follow-up of, when it is one. */
  meeting: ThreadMeeting | null;
  /**
   * Unsent reply text waiting on this thread, written by a meeting report's
   * follow-up. Null for almost every thread.
   */
  draft: ThreadDraft | null;
}

// Sentinel filter value meaning "threads with no assignee".
export const UNASSIGNED = "unassigned";

// Server-side filters for the inbox list. All optional; omitted fields don't
// constrain the query. Applied in the DB (not the client) so search scales past
// the 100-row page.
export interface InboxThreadFilters {
  // Free-text match against subject / counterparty / preview.
  q?: string;
  // Restrict to a single provider channel.
  channel?: InboxChannel;
  // Only threads still marked unread.
  unreadOnly?: boolean;
  // Only threads the operator has starred.
  starredOnly?: boolean;
  // A principal id to restrict to that teammate's threads, or UNASSIGNED for
  // threads with no assignee.
  assignedTo?: string;
}

// Escape PostgREST `or()` filter metacharacters in user input: commas separate
// filters and parens group them, so a raw value could break out of the clause.
function sanitizeForOr(term: string): string {
  return term.replace(/[,()]/g, " ").trim();
}

/**
 * Wake any snoozed threads whose snoozed_until has passed: flip them back to
 * open and clear the wake time, in one org-scoped update. Best-effort — a
 * failure just leaves them snoozed until the next load. Call before reading the
 * board so returned threads reappear on the same render.
 */
export async function autoUnsnoozeExpired(
  supabase: SupabaseClient<Database>,
  orgId: string,
  now: string = new Date().toISOString(),
): Promise<void> {
  await supabase
    .from("inbox_threads")
    .update({ status: "open", snoozed_until: null })
    .eq("organization_id", orgId)
    .eq("status", "snoozed")
    .lte("snoozed_until", now);
}

/**
 * Load the org's inbox threads, newest/hottest first, each shaped with its
 * resolved Command Center context. Deal/investor names are fetched in two batch
 * queries (not N+1) and joined in memory. Optional filters narrow the list in
 * the database so search/channel/unread scale past the page limit.
 */
export async function getInboxThreads(
  supabase: SupabaseClient<Database>,
  filters: InboxThreadFilters = {},
): Promise<InboxThreadView[]> {
  let query = supabase
    .from("inbox_threads")
    .select("*")
    // The inbox focuses on messages — capital, partners, providers, and comms.
    // Shared-deal updates live in their own "deals that fit you" feed.
    .neq("channel", "deal_share");

  if (filters.channel) query = query.eq("channel", filters.channel);
  if (filters.unreadOnly) query = query.eq("unread", true);
  if (filters.starredOnly) query = query.eq("starred", true);
  if (filters.assignedTo === UNASSIGNED) query = query.is("assigned_to", null);
  else if (filters.assignedTo) query = query.eq("assigned_to", filters.assignedTo);
  const term = filters.q ? sanitizeForOr(filters.q) : "";
  if (term) {
    const like = `%${term}%`;
    query = query.or(
      `subject.ilike.${like},counterparty_name.ilike.${like},preview.ilike.${like}`,
    );
  }

  // The drafts are independent of the page read and are wanted either way, so
  // they start together rather than after it.
  const [pageResult, drafts] = await Promise.all([
    query
      .order("priority", { ascending: false })
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(100),
    readThreadDrafts(supabase),
  ]);

  const { data, error } = pageResult;
  if (error || !data) return [];
  let threads = data as InboxThread[];

  /**
   * Pull in the draft-carrying threads this page missed.
   *
   * Not a nicety. A thread created to hold a follow-up has priority 0 and no
   * messages, so under this query's ordering it sorts to the very bottom of the
   * hundred — or past it, on any organisation with a busy inbox. The one thread
   * the operator was told to go and act on would be the one they could not see.
   *
   * Skipped entirely while a filter is active, because a filtered board shows
   * what matches the filter; `missingDraftThreadIds` owns that rule.
   */
  const missing = missingDraftThreadIds({
    draftThreadIds: [...drafts.keys()],
    onPage: threads.map((t) => t.id),
    filtered: Boolean(
      filters.q ||
        filters.channel ||
        filters.unreadOnly ||
        filters.starredOnly ||
        filters.assignedTo,
    ),
  });
  if (missing.length > 0) {
    const { data: extra } = await supabase
      .from("inbox_threads")
      .select("*")
      .in("id", missing)
      // The same exclusion the page read makes: a shared-deal thread belongs to
      // its own feed whether or not something drafted onto it.
      .neq("channel", "deal_share");
    if (extra) threads = [...threads, ...(extra as InboxThread[])];
  }

  const dealIds = [...new Set(threads.map((t) => t.deal_id).filter((v): v is string => !!v))];
  const investorIds = [
    ...new Set(threads.map((t) => t.investor_id).filter((v): v is string => !!v)),
  ];
  const assigneeIds = [
    ...new Set(threads.map((t) => t.assigned_to).filter((v): v is string => !!v)),
  ];

  const meetingIds = [
    ...new Set(threads.map((t) => t.meeting_id).filter((v): v is string => !!v)),
  ];

  const [dealsRes, investorsRes, assigneesRes, meetingsRes] = await Promise.all([
    dealIds.length
      ? supabase.from("deals").select("id, name").in("id", dealIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    investorIds.length
      ? supabase.from("investors").select("id, name").in("id", investorIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    assigneeIds.length
      ? supabase.from("principals").select("id, full_name").in("id", assigneeIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
    meetingIds.length
      ? supabase.from("live_meetings").select("id, title, room_code").in("id", meetingIds)
      : Promise.resolve({ data: [] as { id: string; title: string | null; room_code: string | null }[] }),
  ]);
  const meetingById = new Map(
    ((meetingsRes.data ?? []) as { id: string; title: string | null; room_code: string | null }[]).map((m) => [
      m.id,
      {
        id: m.id,
        title: (m.title ?? "").trim() || "Meeting",
        href: m.room_code ? `/meetings/${m.room_code}/report` : "/meetings",
      },
    ]),
  );

  const dealName = new Map((dealsRes.data ?? []).map((d) => [d.id, d.name]));
  const investorName = new Map((investorsRes.data ?? []).map((i) => [i.id, i.name]));
  const assigneeName = new Map(
    (assigneesRes.data ?? []).map((p) => [p.id, p.full_name || "Teammate"]),
  );

  // Drafts first, then the board's own ordering within each group. A reorder
  // rather than a written priority: stamping a triage score on the thread would
  // put a fabricated number in a column the intelligence layer owns.
  return draftsFirst(
    threads.map((thread) => ({
      thread,
      context: resolveContext(thread, dealName, investorName),
      assignee:
        thread.assigned_to && assigneeName.has(thread.assigned_to)
          ? { id: thread.assigned_to, name: assigneeName.get(thread.assigned_to)! }
          : null,
      meeting: (thread.meeting_id && meetingById.get(thread.meeting_id)) || null,
      draft: drafts.get(thread.id) ?? null,
    })),
    (view) => view.draft !== null,
  );
}

function resolveContext(
  thread: InboxThread,
  dealName: Map<string, string>,
  investorName: Map<string, string>,
): ThreadContext | null {
  // Deal context wins when both are set — the deal is the more specific surface.
  if (thread.deal_id && dealName.has(thread.deal_id)) {
    return {
      kind: "deal",
      id: thread.deal_id,
      name: dealName.get(thread.deal_id)!,
      href: `/deal/${thread.deal_id}`,
    };
  }
  if (thread.investor_id && investorName.has(thread.investor_id)) {
    return {
      kind: "investor",
      id: thread.investor_id,
      name: investorName.get(thread.investor_id)!,
      href: `/investor/${thread.investor_id}`,
    };
  }
  return null;
}

// Injectable seams for refreshThreadSummary — the summarizer defaults to the
// Claude-backed helper (deterministic fallback when no API key), and the clock
// is overridable so the age-driven priority refresh unit-tests deterministically.
export interface RefreshSummaryDeps {
  summarize?: (input: ThreadDigestInput) => Promise<ThreadSummary>;
  now?: () => Date;
}

/**
 * Recompute a thread's AI summary + intent from its recent messages, persist
 * them, and refresh the triage priority with the freshly detected intent (so an
 * urgent cue in the intent — "term sheet, sign today" — lifts the thread in the
 * queue, via the same signal computePriority already reads).
 *
 * Called after an inbound message lands (see the webhook route), so there is one
 * summarization per new message and the cached values survive reload. Fully
 * best-effort: any read/write/model failure leaves the existing values untouched
 * and never throws, so it can never break ingest.
 */
export async function refreshThreadSummary(
  supabase: SupabaseClient<Database>,
  orgId: string,
  threadId: string,
  deps: RefreshSummaryDeps = {},
): Promise<void> {
  const summarize = deps.summarize ?? defaultSummarize;
  const now = deps.now ?? (() => new Date());
  try {
    const { data: t, error } = await supabase
      .from("inbox_threads")
      .select(
        // `channel` is read for the CRM entry below, not for the summary itself.
        "subject, channel, category, counterparty_name, counterparty_email, deal_id, investor_id, unread, last_message_at",
      )
      .eq("organization_id", orgId)
      .eq("id", threadId)
      .maybeSingle();
    if (error || !t) return;

    const { data: msgs } = await supabase
      .from("inbox_messages")
      .select("direction, author, body")
      .eq("organization_id", orgId)
      .eq("thread_id", threadId)
      .order("occurred_at", { ascending: true })
      .limit(20);
    const messages = (msgs ?? []).map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      author: m.author,
      body: m.body,
    }));
    // Nothing to summarize — leave the cached values (and priority) as they are.
    if (!messages.length) return;

    const { summary, intent } = await summarize({
      subject: t.subject,
      category: t.category,
      counterparty: t.counterparty_name ?? t.counterparty_email,
      messages,
    });

    // Recompute priority with the detected intent. Every other signal is already
    // on the row, so this stays a pure re-scoring — no extra queries.
    const lastMs = t.last_message_at ? Date.parse(t.last_message_at) : NaN;
    const ageHours = Number.isNaN(lastMs) ? 0 : Math.max(0, (now().getTime() - lastMs) / 3_600_000);
    const priority = computePriority({
      category: t.category,
      unread: t.unread,
      hasContext: Boolean(t.deal_id || t.investor_id),
      ageHours,
      intent,
    });

    await supabase
      .from("inbox_threads")
      .update({ ai_summary: summary, intent, priority, ai_summary_at: now().toISOString() })
      .eq("organization_id", orgId)
      .eq("id", threadId);

    // Put the summary on the counterparty's CRM record, replacing the raw preview
    // the ingest wrote there a moment ago. Same upsert key, so this corrects that
    // one entry rather than adding a second copy of the conversation — which is
    // the whole reason the key exists. A contact's record should read "Ana asked
    // for the updated pacing model", not "Hi — could you send over".
    await recordThreadOnTimeline(supabase as never, {
      orgId,
      actorId: null,
      now: new Date().toISOString(),
      thread: {
        id: threadId,
        channel: t.channel,
        subject: t.subject,
        counterpartyEmail: t.counterparty_email,
        aiSummary: summary,
        preview: null,
        lastMessageAt: t.last_message_at,
      },
    });
  } catch {
    // Best-effort: a summary refresh must never surface as an ingest failure.
  }
}

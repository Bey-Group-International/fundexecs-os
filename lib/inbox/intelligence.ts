// lib/inbox/intelligence.ts
// The intelligence layer that makes the Unified Inbox more than a merged feed.
// Three jobs, all here:
//
//   1. TRIAGE  — score each thread 0-100 (urgency x relevance) and bucket it, so
//      the operator reads the queue top-down and the right thing is always first.
//   2. NEXT MOVE — map a thread to the single gated action that advances it
//      (reply / propose a time / spin up a room), routed through lib/gates.
//   3. DIGEST  — roll the queue into one glanceable "what needs you" line for the
//      Command Center.
//
// The scoring/bucketing/next-move/digest helpers are PURE (no I/O, no React, no
// DB) so they are unit-tested directly. `summarizeThread` is the one async,
// Claude-backed helper; it degrades to a deterministic summary when no API key is
// configured, so the inbox behaves identically in CI and preview builds.
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, isAnthropicTimeout } from "@/lib/anthropic-client";
import type { ActionKind } from "@/lib/gates";
import type { InboxCategory } from "@/lib/supabase/database.types";

// --- Triage scoring (pure) --------------------------------------------------

export interface TriageSignals {
  category: InboxCategory;
  unread: boolean;
  // True when the thread is linked to a live deal or investor — context the
  // operator already cares about ranks above a cold, unattached message.
  hasContext: boolean;
  // Hours since the last message; newer threads rank higher.
  ageHours: number;
  // The AI-detected (or seeded) intent label, scanned for urgency cues.
  intent?: string | null;
}

// Time-sensitivity floor by pillar: a pending signature or a booking moves on a
// clock, so it outranks an ambient message all else equal.
const CATEGORY_BASE: Record<InboxCategory, number> = {
  signing: 35,
  // Accounting/payments move on a due-date clock — an overdue invoice or a
  // failed payment outranks an ambient message, just under a pending signature.
  finance: 33,
  booking: 30,
  video: 28,
  messaging: 20,
};

const URGENT_CUES =
  /\b(urgent|asap|today|tonight|deadline|eod|term sheet|wire|commit|sign|overdue|past due|payment failed)\b/i;

/**
 * Score a thread 0-100. Deterministic and explainable: a category floor, plus
 * bonuses for being unread, tied to live context, recent, and carrying an
 * urgency cue. Clamped to [0, 100] so the value is always a clean percentage.
 */
export function computePriority(s: TriageSignals): number {
  let score = CATEGORY_BASE[s.category];
  if (s.unread) score += 20;
  if (s.hasContext) score += 20;
  if (s.ageHours <= 2) score += 20;
  else if (s.ageHours <= 24) score += 12;
  else if (s.ageHours <= 72) score += 4;
  if (s.intent && URGENT_CUES.test(s.intent)) score += 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export type PriorityBucket = "now" | "soon" | "later";

export interface BucketMeta {
  key: PriorityBucket;
  label: string;
  tone: "good" | "warn" | "muted";
}

export const PRIORITY_BUCKETS: Record<PriorityBucket, BucketMeta> = {
  now: { key: "now", label: "Needs you now", tone: "good" },
  soon: { key: "soon", label: "Soon", tone: "warn" },
  later: { key: "later", label: "Later", tone: "muted" },
};

/** Bucket a 0-100 priority into the three triage lanes. */
export function priorityBucket(priority: number): PriorityBucket {
  if (priority >= 66) return "now";
  if (priority >= 33) return "soon";
  return "later";
}

// --- Focused / Other split (pure) -------------------------------------------
//
// The LinkedIn-style top split for the communications lane: Focused holds the
// high-signal conversations, Other collects the ambient remainder so it stays
// one click away without crowding the queue. Derived from the same triage
// score, so the two views never contradict the ranking below them.

export type InboxTab = "focused" | "other";

export interface FocusSignals {
  // The 0-100 triage score (computePriority) — the primary signal.
  priority: number;
  // A still-unread thread always earns a place in Focused.
  unread: boolean;
  // Tied to a live deal or investor the operator already cares about.
  hasContext: boolean;
}

/**
 * Route a thread to the Focused or Other tab. Focused holds anything that
 * plausibly needs the operator: ranked above "later", still unread, or tied to
 * a live deal/investor. Other collects the read, low-priority, unattached
 * remainder (digests, cold alerts). Pure and explainable — the same three
 * signals a person would use to decide "does this matter right now?".
 */
export function inboxTab(s: FocusSignals): InboxTab {
  if (priorityBucket(s.priority) !== "later") return "focused";
  if (s.unread) return "focused";
  if (s.hasContext) return "focused";
  return "other";
}

/**
 * Partition threads into the two tabs, preserving input order within each so a
 * caller that pre-sorted by priority keeps that order inside Focused and Other.
 */
export function partitionByTab<T extends FocusSignals>(items: T[]): Record<InboxTab, T[]> {
  const focused: T[] = [];
  const other: T[] = [];
  for (const item of items) (inboxTab(item) === "focused" ? focused : other).push(item);
  return { focused, other };
}

// --- Quick replies (pure) ---------------------------------------------------
//
// LinkedIn-style one-tap smart replies: three short, category-aware openers the
// operator can drop into the composer and edit before sending. Deterministic
// and instant (no model call, no latency) so a chip is always there the moment a
// thread opens — full "Draft with Earn" stays the deeper, AI-backed option.
// Like the fallback draft, a chip only ever acknowledges or asks; it never
// fabricates a figure, date, or commitment.

export interface QuickReplyContext {
  category: InboxCategory;
  // A time is on the table for a booking → the openers shift from "let's find
  // time" to "that works / can we move it".
  meetingAt?: string | null;
}

// Per-pillar opener sets. Booking swaps its set once a meeting time exists.
const QUICK_REPLIES: Record<InboxCategory, string[]> = {
  messaging: ["Thanks — I'll follow up shortly.", "Sounds good.", "Could you share a bit more detail?"],
  booking: ["Happy to find time — I'll send a few options.", "What times work best on your end?", "Let's get something on the calendar."],
  video: ["I'll send a meeting link shortly.", "A quick call works for me.", "Let's set up a video call."],
  signing: ["Reviewing now — I'll get this executed shortly.", "Thanks — I'll sign and send it back.", "One quick question before I sign."],
  finance: ["Received — I'll review this against our records.", "Thanks, looking into this now.", "Let me confirm and come back to you."],
};

// Booking's alternate set, used once a meeting time is on the table.
const BOOKING_WITH_TIME = ["That time works — confirmed.", "Could we shift it slightly?", "Confirmed — talk then."];

/**
 * Three short, tappable reply openers for a thread, by pillar. Booking flips to
 * confirm/reschedule phrasing once a time is proposed. Pure — safe to compute on
 * the server and hand to the client so the composer shows chips with no bundle
 * cost and no round-trip.
 */
export function quickReplies(ctx: QuickReplyContext): string[] {
  if (ctx.category === "booking" && ctx.meetingAt) return [...BOOKING_WITH_TIME];
  return [...QUICK_REPLIES[ctx.category]];
}

// --- Next move (pure) -------------------------------------------------------

export interface SuggestedAction {
  action: ActionKind;
  label: string;
}

/**
 * The single gated next move for a thread, by pillar. Booking flips from
 * "propose a time" to "confirm" once a time is on the table. Signing threads
 * have no inbox-originated move — they are driven from the Docusign flow — so
 * they return null. Finance threads (Xero / Jax) are read-only for now: the
 * acting move (approve a bill, reconcile, pay) is reviewed in the provider, so
 * they surface and triage but carry no inbox-originated dispatch yet.
 */
export function suggestedAction(thread: {
  category: InboxCategory;
  meeting_at?: string | null;
}): SuggestedAction | null {
  switch (thread.category) {
    case "messaging":
      return { action: "send_reply", label: "Reply" };
    case "booking":
      return thread.meeting_at
        ? { action: "confirm_booking", label: "Confirm time" }
        : { action: "propose_meeting", label: "Propose a time" };
    case "video":
      return { action: "create_video_meeting", label: "Create meeting link" };
    case "signing":
      return null;
    case "finance":
      return null;
  }
}

// --- Digest (pure) ----------------------------------------------------------

export interface DigestThread {
  category: InboxCategory;
  status: "open" | "snoozed" | "done";
  unread: boolean;
  priority: number;
}

export interface InboxDigest {
  total: number;
  open: number;
  unread: number;
  // Open threads scored into the "now" bucket — the count that actually demands
  // attention today.
  needsYou: number;
  byCategory: { category: InboxCategory; count: number }[];
  headline: string;
}

/**
 * Roll a set of threads into the Command Center digest. `headline` is a single
 * human line — "3 need you now · 5 unread" — or an all-clear when the queue is
 * quiet, so the dashboard widget reads at a glance.
 */
export function buildDigest(threads: DigestThread[]): InboxDigest {
  const open = threads.filter((t) => t.status === "open");
  const unread = threads.filter((t) => t.unread).length;
  const needsYou = open.filter((t) => priorityBucket(t.priority) === "now").length;

  const counts = new Map<InboxCategory, number>();
  for (const t of open) counts.set(t.category, (counts.get(t.category) ?? 0) + 1);
  const byCategory = [...counts.entries()].map(([category, count]) => ({ category, count }));

  let headline: string;
  if (open.length === 0) headline = "Inbox clear — nothing waiting on you.";
  else {
    const parts: string[] = [];
    if (needsYou > 0) parts.push(`${needsYou} need${needsYou === 1 ? "s" : ""} you now`);
    if (unread > 0) parts.push(`${unread} unread`);
    parts.push(`${open.length} open`);
    headline = parts.join(" · ");
  }

  return { total: threads.length, open: open.length, unread, needsYou, byCategory, headline };
}

// --- AI summary (async, Claude-backed with deterministic fallback) ----------

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export interface ThreadDigestInput {
  subject: string;
  category: InboxCategory;
  counterparty?: string | null;
  messages: { direction: "inbound" | "outbound"; author?: string | null; body: string }[];
}

export interface ThreadSummary {
  summary: string;
  intent: string;
}

export function inboxLive(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "One or two sentences: what the counterparty wants and what is owed back.",
    },
    intent: {
      type: "string",
      description: "A 2-4 word intent label, e.g. 'Scheduling a call' or 'Requesting the deck'.",
    },
  },
  required: ["summary", "intent"],
} as const;

/**
 * Summarize a thread and name its intent. Uses Claude when ANTHROPIC_API_KEY is
 * present; otherwise returns a deterministic summary from the latest inbound
 * message so the inbox stays fully functional offline.
 */
export async function summarizeThread(input: ThreadDigestInput): Promise<ThreadSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackSummary(input);
  try {
    const anthropic = anthropicClient(apiKey);
    const transcript = input.messages
      .slice(-8)
      .map((m) => `${m.direction === "inbound" ? input.counterparty ?? "Them" : "You"}: ${m.body}`)
      .join("\n");
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      system:
        "You triage a private-markets operator's inbox. Given one thread, state plainly what the " +
        "counterparty wants and what the operator owes back. Be terse and specific; never invent facts.",
      output_config: { effort: "low", format: { type: "json_schema", schema: SUMMARY_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Channel pillar: ${input.category}\nSubject: ${input.subject}\n\n${transcript}`,
        },
      ],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return fallbackSummary(input);
    const raw = JSON.parse(text) as Partial<ThreadSummary>;
    const fb = fallbackSummary(input);
    return {
      summary: (typeof raw.summary === "string" && raw.summary.trim()) || fb.summary,
      intent: (typeof raw.intent === "string" && raw.intent.trim()) || fb.intent,
    };
  } catch (err) {
    // A timeout is now a typed, observable event — the fallback is the same.
    if (isAnthropicTimeout(err)) {
      console.warn("[inbox/intelligence] summarize timed out — deterministic fallback");
    }
    return fallbackSummary(input);
  }
}

// Intent guesses by pillar when no model is available — keyed off the latest
// inbound message so the label still reflects what arrived.
const FALLBACK_INTENT: Record<InboxCategory, string> = {
  messaging: "Awaiting your reply",
  booking: "Wants to schedule",
  video: "Video meeting",
  signing: "Signature pending",
  finance: "Needs review",
};

export function fallbackSummary(input: ThreadDigestInput): ThreadSummary {
  const lastInbound = [...input.messages].reverse().find((m) => m.direction === "inbound");
  const snippet = (lastInbound?.body ?? input.subject).replace(/\s+/g, " ").trim().slice(0, 160);
  const who = input.counterparty ?? "The counterparty";
  return {
    summary: snippet ? `${who}: ${snippet}` : `${who} is waiting on you.`,
    intent: FALLBACK_INTENT[input.category],
  };
}

// --- AI reply drafting (async, Claude-backed with deterministic fallback) ----
//
// Drafting is internal prep — it produces text for the operator to review and
// edit, and never reaches the counterparty on its own (the send is the gated
// Tier-2 move). So a draft is always safe to generate; the human stays in the
// loop between the draft and the send.

export interface ThreadDraftResult {
  draft: string;
  // True when Claude produced the draft; false for the deterministic template.
  live: boolean;
}

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    draft: {
      type: "string",
      description:
        "A concise, professional reply the operator can send as-is or edit. First person, no salutation line, no signature.",
    },
  },
  required: ["draft"],
} as const;

/**
 * Draft a reply to a thread on the operator's behalf. Uses Claude when
 * ANTHROPIC_API_KEY is present; otherwise returns a deterministic, category-aware
 * acknowledgement so "Draft with Earn" still gives the operator a starting point
 * offline / in CI. Never sends — the caller shows the draft in the composer.
 */
export async function draftReply(input: ThreadDigestInput): Promise<ThreadDraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { draft: fallbackDraft(input), live: false };
  try {
    const anthropic = anthropicClient(apiKey);
    const transcript = input.messages
      .slice(-8)
      .map((m) => `${m.direction === "inbound" ? input.counterparty ?? "Them" : "You"}: ${m.body}`)
      .join("\n");
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system:
        "You draft replies for a private-markets operator's inbox. Write what the operator would " +
        "send back: concise, professional, first person. Address the counterparty's ask directly. " +
        "Never invent facts, figures, dates, or commitments the thread does not support — if a detail " +
        "is unknown, say you'll follow up rather than fabricate it. No salutation line, no signature.",
      output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
      messages: [
        {
          role: "user",
          content: `Channel pillar: ${input.category}\nSubject: ${input.subject}\nCounterparty: ${input.counterparty ?? "Unknown"}\n\n${transcript}`,
        },
      ],
    });
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (!text) return { draft: fallbackDraft(input), live: false };
    const raw = JSON.parse(text) as { draft?: unknown };
    const draft = typeof raw.draft === "string" ? raw.draft.trim() : "";
    return draft ? { draft, live: true } : { draft: fallbackDraft(input), live: false };
  } catch (err) {
    if (isAnthropicTimeout(err)) {
      console.warn("[inbox/intelligence] draft timed out — deterministic fallback");
    }
    return { draft: fallbackDraft(input), live: false };
  }
}

// Category-aware acknowledgement templates for offline / no-key drafting. Each
// opens by acknowledging the counterparty and commits only to a follow-up, so
// the fallback never fabricates specifics.
const FALLBACK_DRAFT: Record<InboxCategory, string> = {
  messaging:
    "Thanks for the note — I appreciate you reaching out. Let me look into this and I'll come back to you shortly with specifics.",
  booking:
    "Thanks for reaching out — happy to find time. I'll send a couple of options that work on my side shortly.",
  video:
    "Thanks — a call works well. I'll get a meeting link over to you and confirm a time that suits us both.",
  signing:
    "Thanks for flagging this. I'll review the documents on my side and follow up as soon as they're ready to execute.",
  finance:
    "Thanks — I've received this and will review it against our records, then confirm next steps shortly.",
};

export function fallbackDraft(input: ThreadDigestInput): string {
  const who = input.counterparty ?? "there";
  const base = FALLBACK_DRAFT[input.category];
  // Lead with the counterparty's name when known, keeping the body template-safe.
  return who === "there" ? base : base.replace(/^Thanks/, `Thanks, ${who}`);
}

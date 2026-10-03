// lib/inbox/summaries.server.ts
// The hourly summary pass: every thread whose newest message is newer than its
// summary gets one, on a small model, and nothing else does.
//
// Ingest (webhooks, the Gmail sweeps, follow-up sends) writes messages but no
// summary, so every report and timeline built on a synced thread fell back to
// the first two hundred characters of its latest message. Summarising at
// ingest would put a model call on every webhook; summarising when somebody
// opens a report makes the first report slow. This is the middle: once an hour,
// in bulk, only what changed, on Haiku — and the result is cached on the row
// (ai_summary + ai_summary_at) for every reader after that.
//
// Never throws. Bounded per run; a backlog drains over successive hours.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { refreshThreadSummary } from "@/lib/inbox/data";
import { inboxLive, summarizeThread } from "@/lib/inbox/intelligence";

type Client = SupabaseClient<Database>;

/** The model the batch summarises on: small and cheap, the job is two sentences. */
export const SUMMARY_BATCH_MODEL = process.env.CLAUDE_FAST_MODEL || "claude-haiku-4-5";
export const MAX_PER_RUN = 40;
const CONCURRENCY = 4;
/** How many recent threads are inspected for a summary older than their last message. */
const RECENT_WINDOW = 300;

type Candidate = { id: string; organization_id: string; ai_summary_at: string | null; last_message_at: string | null };

/** A thread whose newest message arrived after its summary was written, or that never had one. */
export function needsSummary(t: Pick<Candidate, "ai_summary_at" | "last_message_at">): boolean {
  if (!t.last_message_at) return false;
  if (!t.ai_summary_at) return true;
  return Date.parse(t.last_message_at) > Date.parse(t.ai_summary_at);
}

export interface SummarySweepResult {
  candidates: number;
  summarized: number;
}

export async function refreshStaleSummaries(
  client: Client,
  opts: {
    limit?: number;
    now?: () => Date;
    /** Injected in tests; the default is the inbox summariser on the batch model. */
    refresh?: (orgId: string, threadId: string) => Promise<void>;
  } = {},
): Promise<SummarySweepResult> {
  const result: SummarySweepResult = { candidates: 0, summarized: 0 };
  // No key, no model: the deterministic fallback is what readers already see.
  if (!opts.refresh && !inboxLive()) return result;
  const limit = opts.limit ?? MAX_PER_RUN;

  // PostgREST cannot compare two columns, so: never-summarised threads by
  // recency, plus a recent window checked here for a summary that has aged.
  const cols = "id, organization_id, ai_summary_at, last_message_at";
  const [never, recent] = await Promise.all([
    client
      .from("inbox_threads")
      .select(cols)
      .is("ai_summary_at", null)
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(limit),
    client
      .from("inbox_threads")
      .select(cols)
      .not("ai_summary_at", "is", null)
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(RECENT_WINDOW),
  ]);
  if (never.error || recent.error) {
    console.error("[inbox/summaries] candidate query failed", never.error?.message ?? recent.error?.message);
    return result;
  }

  const seen = new Set<string>();
  const due: Candidate[] = [];
  for (const t of [...((never.data ?? []) as Candidate[]), ...((recent.data ?? []) as Candidate[])]) {
    if (seen.has(t.id) || !needsSummary(t)) continue;
    seen.add(t.id);
    due.push(t);
  }
  due.sort((a, b) => ((a.last_message_at ?? "") < (b.last_message_at ?? "") ? 1 : -1));
  const batch = due.slice(0, limit);
  result.candidates = due.length;

  const refresh =
    opts.refresh ??
    ((orgId: string, threadId: string) =>
      refreshThreadSummary(client, orgId, threadId, {
        summarize: (input) => summarizeThread(input, { model: SUMMARY_BATCH_MODEL }),
        now: opts.now,
      }));

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
      while (next < batch.length) {
        const t = batch[next++];
        try {
          await refresh(t.organization_id, t.id);
          result.summarized++;
        } catch (err) {
          console.warn("[inbox/summaries] thread failed", err);
        }
      }
    }),
  );
  return result;
}

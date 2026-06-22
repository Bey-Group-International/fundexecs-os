// lib/inbox/data.ts
// The read path for the Unified Inbox. Loads an org's threads ranked hottest-
// first (priority desc, then most-recent activity) and resolves each thread's
// deep link — the deal or investor it concerns — into a name + href so an inbox
// item always opens straight into its Command Center context. Best-effort: any
// read failure degrades to an empty list rather than breaking the page.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, InboxThread } from "@/lib/supabase/database.types";

export interface ThreadContext {
  kind: "deal" | "investor";
  id: string;
  name: string;
  href: string;
}

export interface InboxThreadView {
  thread: InboxThread;
  context: ThreadContext | null;
}

/**
 * Load the org's inbox threads, newest/hottest first, each shaped with its
 * resolved Command Center context. Deal/investor names are fetched in two batch
 * queries (not N+1) and joined in memory.
 */
export async function getInboxThreads(
  supabase: SupabaseClient<Database>,
): Promise<InboxThreadView[]> {
  const { data, error } = await supabase
    .from("inbox_threads")
    .select("*")
    // The inbox focuses on messages — capital, partners, providers, and comms.
    // Shared-deal updates live in their own "deals that fit you" feed.
    .neq("channel", "deal_share")
    .order("priority", { ascending: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);
  if (error || !data) return [];
  const threads = data as InboxThread[];

  const dealIds = [...new Set(threads.map((t) => t.deal_id).filter((v): v is string => !!v))];
  const investorIds = [
    ...new Set(threads.map((t) => t.investor_id).filter((v): v is string => !!v)),
  ];

  const [dealsRes, investorsRes] = await Promise.all([
    dealIds.length
      ? supabase.from("deals").select("id, name").in("id", dealIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    investorIds.length
      ? supabase.from("investors").select("id, name").in("id", investorIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const dealName = new Map((dealsRes.data ?? []).map((d) => [d.id, d.name]));
  const investorName = new Map((investorsRes.data ?? []).map((i) => [i.id, i.name]));

  return threads.map((thread) => ({ thread, context: resolveContext(thread, dealName, investorName) }));
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

"use server";

// app/(app)/nav-actions.ts
// Top-nav alert plumbing: the unread counts behind the mailbox (messages) and
// the lightbulb (deals), plus a "mark deals seen" used when the deals feed is
// opened. `getAlertCounts` is what the client polls today; when we move to
// Supabase Realtime the client will subscribe to inbox_threads inserts instead
// and this stays as the initial-load + fallback fetch.
import { createServerClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth";

export interface AlertCounts {
  // Unread messages — capital/LP, partners, providers + email/chat/booking/video
  // (everything that is NOT a shared deal).
  messages: number;
  // Unread shared-deal updates (botmemo-style deal flow).
  deals: number;
}

/** The current unread mailbox + lightbulb counts for the active org. */
export async function getAlertCounts(): Promise<AlertCounts> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return { messages: 0, deals: 0 };
  const orgId = ctx.orgId;

  const supabase = createServerClient();
  const base = () =>
    supabase
      .from("inbox_threads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("unread", true)
      .eq("status", "open");

  const [messagesRes, dealsRes] = await Promise.all([
    base().neq("channel", "deal_share"),
    base().eq("channel", "deal_share"),
  ]);

  return { messages: messagesRes.count ?? 0, deals: dealsRes.count ?? 0 };
}

/** Mark every unread shared-deal alert read — clears the lightbulb badge once
 *  the operator has opened the "deals that fit you" feed. */
export async function markDealAlertsRead(): Promise<void> {
  const ctx = await getSessionContext();
  if (!ctx?.orgId) return;
  const supabase = createServerClient();
  await supabase
    .from("inbox_threads")
    .update({ unread: false })
    .eq("organization_id", ctx.orgId)
    .eq("channel", "deal_share")
    .eq("unread", true)
    .eq("status", "open");
}

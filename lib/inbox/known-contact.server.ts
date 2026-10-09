// lib/inbox/known-contact.server.ts
// Whether a reply may skip approval because it goes to someone the firm
// already knows and has already written to.
//
// Approval exists to catch the message that should not go out. A reply on an
// existing conversation to a contact in the CRM, whom the firm has emailed
// before, is the commonest message there is and the least likely to be that
// one; making every such reply wait for a second person made the queue a
// formality. A new address — not in the CRM, or never written to — still
// waits. The mandate's do-not-contact list still wins (checked by the caller).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeEmail } from "@/lib/crm/contact-match";

type Client = SupabaseClient<Database>;

export async function isKnownContact(client: Client, orgId: string, email: string | null | undefined): Promise<boolean> {
  const e = normalizeEmail(email ?? "");
  if (!e) return false;
  try {
    const raw = (email ?? "").trim();
    const [{ data: contact }, { data: threads }] = await Promise.all([
      client
        .from("network_contacts")
        .select("id")
        .eq("organization_id", orgId)
        .in("email", raw && raw !== e ? [e, raw] : [e])
        .limit(1),
      client
        .from("inbox_threads")
        .select("id")
        .eq("organization_id", orgId)
        .eq("counterparty_email_lower", e)
        .limit(50),
    ]);
    if (!contact?.length || !threads?.length) return false;
    // Written to before: an outbound message that actually went (only delivered
    // sends are recorded as outbound).
    const { data: sent } = await client
      .from("inbox_messages")
      .select("id")
      .eq("organization_id", orgId)
      .eq("direction", "outbound")
      .in("thread_id", (threads as Array<{ id: string }>).map((t) => t.id))
      .limit(1);
    return Boolean(sent?.length);
  } catch {
    return false;
  }
}

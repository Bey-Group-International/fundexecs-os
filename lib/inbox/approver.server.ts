// lib/inbox/approver.server.ts
// Who may approve an inbox message: anyone but its author.
//
// A message held for approval and then approved by the person who wrote it has
// been reviewed by nobody. The author can still reject it, edit it or send it
// back to Earn; approving it takes a second person. Owners and admins may
// approve their own — someone has to be able to, in a firm of one.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { extractInboxReply, legacyActionFromTask } from "@/lib/inbox/pending-action";

type Client = SupabaseClient<Database>;

export const SELF_APPROVAL_REFUSED =
  "You wrote this message, so someone else has to approve it. Owners and admins can approve their own.";

/** Roles that may approve a message they wrote. */
export function canOverrideOwnApproval(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export async function memberRole(client: Client, orgId: string, userId: string): Promise<string | null> {
  const { data } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("principal_id", userId)
    .maybeSingle();
  return ((data as { role?: string } | null)?.role ?? null) as string | null;
}

/**
 * The reason this person may not approve this task, or null. Only inbox
 * messages carry an author rule; every other approval is untouched.
 */
export async function selfApprovalRefusal(
  client: Client,
  orgId: string,
  actorId: string,
  taskId: string,
): Promise<string | null> {
  const { data } = await client
    .from("tasks")
    .select("title, description, created_by, result")
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return null;
  const t = data as { title: string | null; description: string | null; created_by: string | null; result: unknown };
  const author = extractInboxReply(t.result)?.senderId ?? legacyActionFromTask(t)?.senderId ?? null;
  if (!author || author !== actorId) return null;
  return canOverrideOwnApproval(await memberRole(client, orgId, actorId)) ? null : SELF_APPROVAL_REFUSED;
}

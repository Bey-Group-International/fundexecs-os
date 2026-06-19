// lib/integrations/log.ts
// Persistence seam for the dispatch layer. `dispatchAction` is deliberately pure
// (no DB) so it stays unit-testable; `recordDispatch` is the thin write that
// turns a DispatchResult into one append-only `dispatch_log` row at the call
// site. Best-effort: a logging failure must never break the caller's flow, so
// the insert error is swallowed (the dispatch already happened).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { DispatchResult } from "./types";

export interface RecordDispatchInput {
  orgId: string;
  actorId: string;
  // The task this dispatch belongs to, when one exists.
  taskId?: string | null;
  // The action that was dispatched (lib/gates.ts ActionKind, as text).
  action: string;
  // The structured outcome from dispatchAction.
  result: DispatchResult;
}

export async function recordDispatch(
  supabase: SupabaseClient<Database>,
  { orgId, actorId, taskId, action, result }: RecordDispatchInput,
): Promise<void> {
  await supabase.from("dispatch_log").insert({
    organization_id: orgId,
    task_id: taskId ?? null,
    action,
    channel: result.channel,
    live: result.live,
    ok: result.ok,
    detail: result.detail,
    reference: result.reference ?? null,
    created_by: actorId,
  });
}

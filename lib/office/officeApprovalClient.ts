// Browser-side bridge from the office program store to the server-enforced
// approval RPC (office_decide_approval). Turns a Supabase client + org id into
// a ServerApprovalDecider the store can call; the real authorization happens in
// the database (RLS + the RPC's role-by-tier check), not here.

import type { createClient } from "@/lib/supabase/client";
import type { ServerApprovalDecider } from "@/components/virtual-office/program/officeProgramStore";

type BrowserClient = ReturnType<typeof createClient>;

// office_decide_approval isn't in the generated Database["public"]["Functions"]
// union yet (regenerate once the migration is applied), so the strongly-typed
// .rpc() overload rejects the name. Cast just the call — same approach the
// repo uses for other not-yet-generated RPCs.
type LooseRpc = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ error: { message: string } | null }>;

/**
 * Build a decider that routes office approval decisions through the
 * office_decide_approval RPC. Approvals are authorized server-side against the
 * caller's trusted org role; an unauthorized approval returns { ok: false }
 * with the database error so the store can keep the gate pending.
 */
export function makeServerApprovalDecider(supabase: BrowserClient, orgId: string): ServerApprovalDecider {
  const rpc = supabase.rpc.bind(supabase) as unknown as LooseRpc;
  return async ({ gateKey, tier, title, decision }) => {
    const { error } = await rpc("office_decide_approval", {
      p_org: orgId,
      p_gate_key: gateKey,
      p_workflow_title: title,
      p_tier: tier,
      p_decision: decision,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  };
}

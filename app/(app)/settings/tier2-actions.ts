// The Tier-2 action kinds an operator may pre-authorize in a mandate, with
// operator-facing labels. Tier 1 is always free (no need to authorize) and
// Tier 3 is never delegable — only these may appear in a mandate. Derived from
// the gate layer so the list can never drift from `tierForAction`.
//
// Kept in a plain module (not the "use server" actions file, whose exports must
// all be async) so both the server action and the client form can import it.
import { tierForAction, type ActionKind } from "@/lib/gates";

export const TIER_2_ACTIONS: { kind: ActionKind; label: string }[] = (
  [
    ["send_outreach", "Send outreach"],
    ["send_intro_request", "Request warm intro"],
    ["share_materials", "Share materials"],
    ["send_diligence_request", "Send diligence request"],
    ["distribute_report", "Distribute report"],
  ] as [ActionKind, string][]
)
  .filter(([kind]) => tierForAction(kind) === 2)
  .map(([kind, label]) => ({ kind, label }));

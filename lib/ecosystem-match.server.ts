// lib/ecosystem-match.server.ts
// Instant ecosystem matchmaking — the I/O orchestration. Wraps the pure core in
// lib/ecosystem-match with the cross-org reads and the alert fan-out that turn a
// fresh profile into live notifications. Runs under the service role because it
// crosses organization boundaries (it reads other orgs' public firm profiles and
// writes a thread into their inbox), which RLS rightly forbids the request-bound
// client from doing.
//
// Everything here is never-block: this is a delight, not a gate. A missing
// service key, an empty ecosystem, or a write failure must never strand the
// operator outside the org they just created — the caller ignores the result.
import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { computePriority } from "@/lib/inbox/intelligence";
import {
  rankEcosystemMatches,
  buildInboundAlert,
  buildDigestAlert,
  type EcoOrgProfile,
  type EcoMatch,
} from "@/lib/ecosystem-match";
import type { Database } from "@/lib/supabase/database.types";

type ThreadInsert = Database["public"]["Tables"]["inbox_threads"]["Insert"];

export interface MatchNotifyResult {
  matched: number;
  alerted: number;
}

const NONE: MatchNotifyResult = { matched: 0, alerted: 0 };

// Bound the candidate scan so a large ecosystem stays a single cheap query. The
// matcher ranks in memory; the cap simply protects the onboarding path.
const CANDIDATE_LIMIT = 500;

// The firm-profile columns the matcher needs, from organizations.
const ORG_COLS =
  "id, name, operator_role, primary_strategy, hq_location, jurisdiction, aum_range, discoverable";

interface OrgRow {
  id: string;
  name: string;
  operator_role: string | null;
  primary_strategy: string | null;
  hq_location: string | null;
  jurisdiction: string | null;
  aum_range: string | null;
  discoverable: boolean | null;
}

function toProfile(row: OrgRow): EcoOrgProfile {
  return {
    id: row.id,
    name: row.name,
    operatorRole: row.operator_role,
    strategy: row.primary_strategy,
    location: row.hq_location,
    jurisdiction: row.jurisdiction,
    aumRange: row.aum_range,
  };
}

// Build the inbox_threads row for an ecosystem match alert. Channel `ecosystem`
// + category `messaging` so it reads as the first-class professional alert it
// is and rides the same triage/priority rail as every other inbox item. Fresh
// (ageHours 0) and unread, so it surfaces at the top of the recipient's queue.
function alertThread(
  orgId: string,
  copy: { subject: string; preview: string; aiSummary: string; intent: string },
  counterpartyName: string | null,
  nowIso: string,
): ThreadInsert {
  return {
    organization_id: orgId,
    channel: "ecosystem",
    category: "messaging",
    subject: copy.subject,
    counterparty_name: counterpartyName,
    counterparty_email: null,
    preview: copy.preview,
    status: "open",
    unread: true,
    priority: computePriority({
      category: "messaging",
      unread: true,
      hasContext: false,
      ageHours: 0,
      intent: copy.intent,
    }),
    intent: copy.intent,
    ai_summary: copy.aiSummary,
    last_message_at: nowIso,
  };
}

/**
 * Match a newly-onboarded org across the ecosystem and fan out professional
 * alerts — two-way. Each of the top matches (score ≥ 60, capped) gets an inbound
 * alert about the newcomer; the newcomer gets one reciprocal digest of who they
 * matched. Gated on discoverability: a viewer that has opted out is skipped, and
 * only discoverable orgs are ever surfaced or notified.
 */
export async function matchNewOrgAndNotify(orgId: string): Promise<MatchNotifyResult> {
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return NONE; // No service role configured (e.g. preview/CI) — skip silently.
  }

  // Load the newcomer's own firm profile.
  const { data: viewerRow } = await supabase
    .from("organizations")
    .select(ORG_COLS)
    .eq("id", orgId)
    .maybeSingle<OrgRow>();
  if (!viewerRow || viewerRow.discoverable === false) return NONE;

  // Pull the discoverable ecosystem — every other opted-in org.
  const { data: candidateRows } = await supabase
    .from("organizations")
    .select(ORG_COLS)
    .neq("id", orgId)
    .eq("discoverable", true)
    .limit(CANDIDATE_LIMIT);

  const viewer = toProfile(viewerRow);
  const candidates = ((candidateRows ?? []) as OrgRow[]).map(toProfile);
  const matches: EcoMatch[] = rankEcosystemMatches(viewer, candidates, { minScore: 60, limit: 5 });
  if (matches.length === 0) return { matched: 0, alerted: 0 };

  const nowIso = new Date().toISOString();
  const threads: ThreadInsert[] = [];

  // Inbound: alert each matching org about the newcomer.
  for (const match of matches) {
    threads.push(alertThread(match.org.id, buildInboundAlert(viewer, match), viewer.name, nowIso));
  }

  // Reciprocal: one digest into the newcomer's own bell — the two-way half.
  threads.push(alertThread(orgId, buildDigestAlert(viewer, matches), "Earn", nowIso));

  const { error } = await supabase.from("inbox_threads").insert(threads);
  if (error) return { matched: matches.length, alerted: 0 };

  return { matched: matches.length, alerted: threads.length };
}

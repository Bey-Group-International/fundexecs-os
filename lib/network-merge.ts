// lib/network-merge.ts
//
// Merging two contact records.
//
// Duplicates are the normal state of an institutional contact book: two people
// add the same LP from two sources, an import runs twice, someone changes firms
// and is entered again. The cost is not the extra row — it is that the history
// splits, so neither record tells the truth about the relationship.
//
// The merge rules, in order of what they protect:
//
//   1. The loser's row is KEPT, archived, and tombstoned with merged_into_id.
//      Deleting it would break every foreign key pointing at it (activities,
//      tasks, outreach drafts, suppression entries) and would let a re-import
//      recreate the duplicate as if it were new.
//   2. Field-level fill, never overwrite. The winner's populated fields stand;
//      the loser only contributes where the winner is empty. A merge should
//      never silently replace a value someone entered.
//   3. The strictest compliance state wins, regardless of which record it came
//      from. If either copy is unsubscribed, the merged relationship is
//      unsubscribed. An opt-out must survive a merge or it is not an opt-out.
//   4. History moves wholesale: activities and tasks are reparented so the
//      merged record carries the full relationship.

export interface MergeableContact {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  title?: string | null;
  company?: string | null;
  company_domain?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  avatar_url?: string | null;
  location?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  capital_role?: string | null;
  relationship_type?: string | null;
  relationship_owner?: string | null;
  strength_score?: number | null;
  strength_label?: string | null;
  relevance_score?: number | null;
  stage?: string | null;
  visibility?: string | null;
  connected_on?: string | null;
  last_activity_at?: string | null;
  next_step_at?: string | null;
  verified?: boolean | null;
  confidence?: number | null;
  communication_status?: string | null;
  consent_basis?: string | null;
  consent_at?: string | null;
  compliance_flags?: string[] | null;
}

/** Fields the loser may fill in when the winner has nothing there. */
const FILLABLE = [
  "title",
  "company",
  "company_domain",
  "email",
  "phone",
  "linkedin_url",
  "avatar_url",
  "location",
  "relationship_type",
  "relationship_owner",
  "connected_on",
  "next_step_at",
  "consent_basis",
  "consent_at",
] as const;

/**
 * Outbound eligibility, strictest-first.
 *
 * Anything that is not an explicit permission to contact outranks 'allowed':
 * a merge is not an occasion to recover a lost permission.
 */
const COMMS_SEVERITY: Record<string, number> = {
  blocked: 5,
  do_not_contact: 4,
  unsubscribed: 3,
  bounced: 2,
  allowed: 1,
};

export function strictestCommunicationStatus(a: string | null, b: string | null): string {
  const left = a ?? "allowed";
  const right = b ?? "allowed";
  const ls = COMMS_SEVERITY[left] ?? 3; // an unknown status is treated as restrictive
  const rs = COMMS_SEVERITY[right] ?? 3;
  return ls >= rs ? left : right;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function laterOf(a: string | null | undefined, b: string | null | undefined): string | null {
  const am = a ? Date.parse(a) : NaN;
  const bm = b ? Date.parse(b) : NaN;
  if (Number.isNaN(am) && Number.isNaN(bm)) return null;
  if (Number.isNaN(am)) return b ?? null;
  if (Number.isNaN(bm)) return a ?? null;
  return am >= bm ? (a ?? null) : (b ?? null);
}

export interface MergePlan {
  /** Columns to write onto the surviving record. Empty when nothing changes. */
  patch: Record<string, unknown>;
  /** Human-readable account of what the merge did, for the timeline entry. */
  summary: string[];
}

/**
 * Compute what the surviving record should look like. Pure: it decides, the
 * caller writes, and the tests can check the rules without a database.
 */
export function planMerge(winner: MergeableContact, loser: MergeableContact): MergePlan {
  const patch: Record<string, unknown> = {};
  const summary: string[] = [];

  for (const field of FILLABLE) {
    const mine = winner[field];
    const theirs = loser[field];
    if (isEmpty(mine) && !isEmpty(theirs)) {
      patch[field] = theirs;
      summary.push(`filled ${field.replace(/_/g, " ")}`);
    }
  }

  // Tags are additive — both records' labels describe the same person.
  const mergedTags = [...new Set([...(winner.tags ?? []), ...(loser.tags ?? [])])];
  if (mergedTags.length > (winner.tags ?? []).length) {
    patch.tags = mergedTags;
    summary.push("combined tags");
  }

  // Compliance flags are additive for the same reason, and never dropped.
  const mergedFlags = [...new Set([...(winner.compliance_flags ?? []), ...(loser.compliance_flags ?? [])])];
  if (mergedFlags.length > (winner.compliance_flags ?? []).length) {
    patch.compliance_flags = mergedFlags;
    summary.push("combined compliance flags");
  }

  const comms = strictestCommunicationStatus(
    winner.communication_status ?? null,
    loser.communication_status ?? null,
  );
  if (comms !== (winner.communication_status ?? "allowed")) {
    patch.communication_status = comms;
    summary.push(`kept the stricter outbound status (${comms})`);
  }

  // Scores: the higher of the two. Both were computed from real signal, and
  // taking the max means a merge never makes a relationship look colder.
  if ((loser.strength_score ?? 0) > (winner.strength_score ?? 0)) {
    patch.strength_score = loser.strength_score;
    patch.strength_label = loser.strength_label ?? winner.strength_label ?? "cold";
    summary.push("took the higher warmth score");
  }
  if ((loser.relevance_score ?? 0) > (winner.relevance_score ?? 0)) {
    patch.relevance_score = loser.relevance_score;
  }

  // Recency is a fact about the relationship, not about the row.
  const lastActivity = laterOf(winner.last_activity_at, loser.last_activity_at);
  if (lastActivity && lastActivity !== winner.last_activity_at) {
    patch.last_activity_at = lastActivity;
    summary.push("took the more recent activity date");
  }

  if (loser.verified === true && winner.verified !== true) {
    patch.verified = true;
    patch.confidence = Math.max(winner.confidence ?? 0, loser.confidence ?? 0);
    summary.push("carried over verification");
  }

  // Notes concatenate rather than overwrite: they are the one field where
  // losing a sentence loses the reason someone wrote it down.
  const theirNotes = loser.notes?.trim();
  if (theirNotes) {
    const mine = winner.notes?.trim();
    if (!mine) {
      patch.notes = theirNotes;
      summary.push("carried over notes");
    } else if (!mine.includes(theirNotes)) {
      patch.notes = `${mine}\n\n— merged from duplicate —\n${theirNotes}`;
      summary.push("appended the duplicate's notes");
    }
  }

  // A private record merged into a shared one stays shared; a shared record
  // merged into a private one becomes shared, because the information was
  // already visible to the org and a merge cannot un-share it.
  if (winner.visibility === "private" && loser.visibility === "org") {
    patch.visibility = "org";
    summary.push("kept organization visibility");
  }

  return { patch, summary };
}

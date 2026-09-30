// lib/inbox/crm-activity.server.ts
// Putting an inbox conversation on the CRM record of the person on the other end.
//
// The rules are in crm-activity.ts and tested there. This does the two things
// that need a database: look up whether the counterparty is a contact, and
// upsert the row.
//
// Never throws. Ingest is a webhook path: a thread that arrives and cannot reach
// the CRM must still reach the inbox, or a provider retries the delivery and the
// operator loses the message. Every failure is logged and reported as zero.

import { normalizeEmail } from "@/lib/crm/contact-match";
import { threadActivity, type InboxThreadForCrm } from "@/lib/inbox/crm-activity";

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/**
 * The query builder, spelled out rather than typed `any` — only the methods this
 * file calls, so a typo in a chain is caught here rather than at runtime.
 */
interface Builder extends PromiseLike<QueryResult<Array<Record<string, unknown>>>> {
  select: (columns: string) => Builder;
  eq: (column: string, value: unknown) => Builder;
  limit: (n: number) => Builder;
  maybeSingle: () => PromiseLike<QueryResult<Record<string, unknown>>>;
  upsert: (rows: unknown[], options: { onConflict: string }) => PromiseLike<QueryResult<unknown>>;
}

type Client = { from: (table: string) => Builder };

/**
 * The conflict target, matching network_activities_thread_contact_uniq.
 *
 * Exported so a test can assert the shape PostgREST accepts — plain column names
 * — rather than comparing it against whatever this file happens to say. The
 * meetings writer learned that the hard way: a target naming an expression fails
 * on every call, silently, and a test comparing it to the migration passes
 * because both are wrong together.
 */
export const THREAD_CONFLICT_TARGET = "organization_id,contact_id,thread_id";

export interface RecordThreadResult {
  /** Rows written. Zero is the common case: most of an inbox is not in the CRM. */
  written: number;
  /** Set when something went wrong; the caller carries on regardless. */
  failed: boolean;
}

/**
 * Log this thread against the contact it is with, if the CRM knows them.
 *
 * Called on every ingest, including the ones that only update an existing
 * thread, because the row is meant to stay current: the newest summary and the
 * latest message time belong on the record, not the state of the conversation
 * when it started.
 */
export async function recordThreadOnTimeline(
  client: Client,
  input: {
    orgId: string | null;
    thread: InboxThreadForCrm;
    /** The principal the ingest is attributed to, when there is one. */
    actorId: string | null;
    now: string;
  },
): Promise<RecordThreadResult> {
  // Activities are scoped to an organisation by a NOT NULL column.
  if (!input.orgId) return { written: 0, failed: false };

  const email = normalizeEmail(input.thread.counterpartyEmail);
  // No address, nothing to match on, no lookup worth making. Most Slack and
  // calendar notifications land here.
  if (!email) return { written: 0, failed: false };

  try {
    const contactId = await contactIdFor(client, input.orgId, email);
    if (!contactId) return { written: 0, failed: false };

    const row = threadActivity({
      thread: input.thread,
      contactsByEmail: new Map([[email, contactId]]),
      now: input.now,
    });
    if (!row) return { written: 0, failed: false };

    const { error } = await client.from("network_activities").upsert(
      [
        {
          organization_id: input.orgId,
          contact_id: row.contactId,
          actor_id: input.actorId,
          activity_type: row.activityType,
          direction: row.direction,
          subject: row.subject,
          body: row.body,
          occurred_at: row.occurredAt,
          is_system: row.isSystem,
          metadata: row.metadata,
        },
      ],
      { onConflict: THREAD_CONFLICT_TARGET },
    );

    if (error) {
      console.error("[inbox/crm-activity] timeline write failed", error.message);
      return { written: 0, failed: true };
    }
    return { written: 1, failed: false };
  } catch (err) {
    console.error("[inbox/crm-activity] recording thread on timeline", err);
    return { written: 0, failed: true };
  }
}

/**
 * The contact holding this address, or null.
 *
 * Filters on `email_lower`, not `email`: network_contacts.email holds whatever
 * case it was given, and comparing a lowercased address against the raw column
 * misses every contact stored capitalised — a miss that reads exactly like "they
 * are not in the CRM".
 */
async function contactIdFor(client: Client, orgId: string, email: string): Promise<string | null> {
  const { data, error } = await client
    .from("network_contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("email_lower", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[inbox/crm-activity] contact lookup failed", error.message);
    return null;
  }
  const id = (data as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

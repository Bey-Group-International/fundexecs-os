import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { ingestInboxItems } from '@/lib/inbox/ingest';
import type { ProviderSignals } from './types';

type Admin = SupabaseClient<Database>;

interface IngestTarget {
  orgId: string;
  userId: string;
  connectionId: string | null;
  provider: string;
}

export interface IngestResult {
  contacts: number;
  interactions: number;
  /** Conversations surfaced into the Relationship Inbox for triage. */
  inboxItems: number;
}

/**
 * Upserts contacts (deduped by org + email), then inserts the normalized
 * interactions (idempotent on org + provider + external_ref). Inserting
 * interactions fires the DB trigger that maintains `relationships` warmth —
 * so warm connections update automatically. Must be called with an admin
 * (service-role) client.
 */
export async function ingestSignals(
  admin: Admin,
  target: IngestTarget,
  signals: ProviderSignals
): Promise<IngestResult> {
  const { orgId, userId, connectionId, provider } = target;

  // 1. Upsert contacts that have an email; build an email -> id map.
  const emailToId = new Map<string, string>();
  const contactRows = signals.contacts
    .filter((c) => c.email)
    .map((c) => ({
      org_id: orgId,
      primary_email: c.email!.toLowerCase(),
      full_name: c.fullName ?? null,
      company: c.company ?? null,
      title: c.title ?? null,
      source_provider: provider
    }));

  // De-dupe rows by email before upserting.
  const uniqueContacts = Array.from(new Map(contactRows.map((r) => [r.primary_email, r])).values());

  if (uniqueContacts.length > 0) {
    const { data, error } = await admin
      .from('contacts')
      .upsert(uniqueContacts, { onConflict: 'org_id,primary_email' })
      .select('id, primary_email');
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.primary_email) emailToId.set(row.primary_email.toLowerCase(), row.id);
    }
  }

  // 2. Build interaction rows, resolving contact_id from email where possible.
  const interactionRows = signals.interactions.map((i) => ({
    org_id: orgId,
    user_id: userId,
    connection_id: connectionId,
    contact_id: i.contactEmail ? (emailToId.get(i.contactEmail.toLowerCase()) ?? null) : null,
    provider,
    type: i.type,
    direction: i.direction,
    occurred_at: i.occurredAt,
    subject: i.subject ?? null,
    summary: i.summary ?? null,
    external_ref: i.externalRef
  }));

  let interactions = 0;
  if (interactionRows.length > 0) {
    const { data, error } = await admin
      .from('interactions')
      .upsert(interactionRows, {
        onConflict: 'org_id,provider,external_ref',
        ignoreDuplicates: true
      })
      .select('id');
    if (error) throw error;
    interactions = data?.length ?? 0;
  }

  // 3. Surface the same conversations into the Relationship Inbox for triage,
  // reusing the email -> contact map so items resolve to known contacts. This
  // is additive: an inbox write failure must never abort the core
  // contacts/interactions sync (and its warmth trigger), so it's isolated.
  let inboxItems = 0;
  try {
    inboxItems = await ingestInboxItems(admin, { orgId, provider }, signals, emailToId);
  } catch (error) {
    console.error('inbox_ingest_failed', {
      orgId,
      provider,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return { contacts: uniqueContacts.length, interactions, inboxItems };
}

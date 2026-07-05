// Gmail routed through Composio (GMAIL_FETCH_EMAILS) into the Professional
// Network relationship layer — as *metadata-only* relationship signal, never
// content mining and never outreach.
//
// What this reads: the sender identity (name + address) of recent messages, so a
// real correspondent becomes a first-party contact in the Capital Relationship
// Graph. What it never does: send, draft, label, or exfiltrate message bodies.
// Every derived contact flows through the SAME addProfessionalContact pipeline
// as manual entry — so dedupe blocks silent duplicates and a high-confidence
// collision is surfaced for review rather than force-inserted (review-before-save).
//
// The mappers are pure (inject sample payloads, zero network); the sync path is
// the only piece that touches Composio + the DB.

import { normalizeProfile } from "@/lib/integrations/professional-network/normalize-profile";
import { addProfessionalContact } from "@/lib/integrations/professional-network/pipeline.server";
import type {
  ConnectorSyncContext,
  ConnectorSyncResult,
  ProfileInput,
} from "@/lib/integrations/professional-network/types";
import {
  composioConfigForOrg,
  executeComposioTool,
  type ComposioConfig,
} from "./client.server";

export const COMPOSIO_GMAIL_FETCH_TOOL = "GMAIL_FETCH_EMAILS";

/** A Gmail message as GMAIL_FETCH_EMAILS may report it (field names vary). */
interface GmailHeader {
  name?: string;
  value?: string;
}
interface GmailMessage {
  messageId?: string;
  id?: string;
  threadId?: string;
  sender?: string;
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  subject?: string;
  payload?: { headers?: GmailHeader[] };
}
interface GmailFetchPayload {
  messages?: GmailMessage[];
  data?: { messages?: GmailMessage[] };
}

/** Parse an RFC-5322 address like `"Jane Doe" <jane@x.com>` → name + email. */
export function parseEmailAddress(raw: string | undefined | null): { name: string | null; email: string | null } {
  if (!raw) return { name: null, email: null };
  const s = raw.trim();
  const angled = s.match(/^(.*?)<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].trim().replace(/^"(.*)"$/, "$1").trim();
    const email = angled[2].trim().toLowerCase();
    return { name: name || null, email: email || null };
  }
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { name: null, email: s.toLowerCase() };
  return { name: null, email: null };
}

/** Pull a header value off a message, tolerant of the flat vs payload.headers shapes. */
function headerValue(msg: GmailMessage, field: "from" | "sender" | "to" | "cc"): string | undefined {
  const direct = field === "from" ? msg.from ?? msg.sender : field === "sender" ? msg.sender : msg[field];
  if (typeof direct === "string" && direct) return direct;
  if (Array.isArray(direct) && direct.length) return direct.join(", ");
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === field);
  return h?.value ?? undefined;
}

function messagesOf(payload: GmailFetchPayload | GmailMessage[] | null | undefined): GmailMessage[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(payload.data?.messages)) return payload.data!.messages!;
  return [];
}

export interface GmailMapOptions {
  /** Header fields to read correspondents from. Defaults to the sender only. */
  fields?: Array<"from" | "sender" | "to" | "cc">;
  /** Addresses to treat as "self" and exclude (never import the mailbox owner). */
  selfEmails?: string[];
}

/**
 * Derive unique correspondents from a batch of Gmail messages. Reads only sender
 * (default) identity headers, dedupes by email, and drops self + address-less
 * entries. Pure — no I/O.
 */
export function mapGmailMessagesToProfileInputs(
  payload: GmailFetchPayload | GmailMessage[] | null | undefined,
  opts: GmailMapOptions = {},
): ProfileInput[] {
  const fields = opts.fields ?? ["from"];
  const self = new Set((opts.selfEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean));
  const byEmail = new Map<string, ProfileInput>();

  for (const msg of messagesOf(payload)) {
    for (const field of fields) {
      const rawHeader = headerValue(msg, field);
      if (!rawHeader) continue;
      // A to/cc header may carry several comma-separated addresses.
      for (const part of rawHeader.split(",")) {
        const { name, email } = parseEmailAddress(part);
        if (!email || self.has(email) || byEmail.has(email)) continue;
        byEmail.set(email, { email, fullName: name ?? undefined });
      }
    }
  }

  return Array.from(byEmail.values());
}

export interface SyncGmailDeps {
  /** Test seam: a ready ComposioConfig; when provided, skips key resolution. */
  composio?: ComposioConfig | null;
  /** Max messages to scan for correspondents. */
  maxResults?: number;
  /** Gmail search query narrowing the scan window (defaults to recent inbox). */
  query?: string;
  /** Header fields + self-exclusion passed through to the mapper. */
  map?: GmailMapOptions;
}

/**
 * Full Gmail relationship-signal sync: resolve the org's Composio key, fetch a
 * bounded batch of recent messages, derive correspondents, and route each
 * through the shared normalize → dedupe → insert pipeline as an `email` source.
 * Degrades cleanly (never throws) to a persistable ConnectorSyncResult.
 */
export async function syncGmailContacts(
  orgId: string,
  ctx: ConnectorSyncContext,
  deps: SyncGmailDeps = {},
): Promise<ConnectorSyncResult> {
  const config = deps.composio !== undefined ? deps.composio : await composioConfigForOrg(orgId);
  if (!config) {
    return {
      ok: false,
      recordsSeen: 0,
      recordsImported: 0,
      error: "Gmail is not connected via Composio for this organization.",
    };
  }

  const res = await executeComposioTool<GmailFetchPayload>(config, COMPOSIO_GMAIL_FETCH_TOOL, {
    query: deps.query ?? "in:inbox -in:spam",
    max_results: deps.maxResults ?? 100,
    verbose: false,
  });
  if (!res.ok) {
    return { ok: false, recordsSeen: 0, recordsImported: 0, error: res.error };
  }

  const people = mapGmailMessagesToProfileInputs(res.data, deps.map);

  let created = 0;
  let deduped = 0;
  for (const input of people) {
    const normalized = normalizeProfile(input, "email");
    if ("error" in normalized) continue; // seen but no usable identity
    const result = await addProfessionalContact(ctx.supabase, {
      orgId,
      userId: ctx.userId,
      profile: normalized,
    });
    if (result.ok) created += 1;
    else if (result.needsReview) deduped += 1;
    // A hard insert error is skipped so one bad row can't fail the whole sync.
  }

  return { ok: true, recordsSeen: people.length, recordsImported: created, recordsDeduped: deduped };
}

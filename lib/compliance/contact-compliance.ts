// lib/compliance/contact-compliance.ts
// Compliance-by-design for the native Relationship Intelligence Engine.
//
// Before any contact is enrolled in a sequence or messaged, the outreach path
// asks this module: may we contact them? A contact is blocked when their
// communication_status is anything but "allowed", when a compliance flag
// requires review, or when they match the org's do-not-contact suppression list
// (by contact id, exact email, or company domain). Everything is native — no
// external service — and evaluateContactability is a pure function so the gate
// is fully unit-testable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type CommunicationStatus =
  | "allowed"
  | "unsubscribed"
  | "bounced"
  | "do_not_contact"
  | "blocked";

// Compliance flags that block outbound regardless of communication_status.
const BLOCKING_FLAGS = new Set(["do_not_contact", "restricted", "legal_hold", "sanctioned"]);

export interface ContactComplianceState {
  communication_status?: string | null;
  compliance_flags?: string[] | null;
}

export interface Contactability {
  contactable: boolean;
  status: CommunicationStatus;
  reason?: string;
}

// Pure gate: given a contact's compliance state (and whether it matched the
// suppression list), decide whether outbound is permitted. Suppression and a
// non-"allowed" status both hard-block; a blocking compliance flag blocks too.
export function evaluateContactability(
  contact: ContactComplianceState | null | undefined,
  opts: { suppressed?: boolean } = {},
): Contactability {
  if (opts.suppressed) {
    return { contactable: false, status: "do_not_contact", reason: "On the do-not-contact list" };
  }
  const status = (contact?.communication_status ?? "allowed") as CommunicationStatus;
  if (status !== "allowed") {
    return { contactable: false, status, reason: `Communication status is "${status}"` };
  }
  const blocking = (contact?.compliance_flags ?? []).find((f) => BLOCKING_FLAGS.has(f));
  if (blocking) {
    return { contactable: false, status: "blocked", reason: `Compliance flag: ${blocking}` };
  }
  return { contactable: true, status: "allowed" };
}

// New tables/columns aren't in the generated Database types yet; use an untyped
// client view for them (the repo's standard pattern for pre-regeneration DDL).
function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

// Does this org's do-not-contact list suppress the target? Matches by contact
// id, exact (case-insensitive) email, or company domain.
async function isSuppressed(
  db: SupabaseClient<Database>,
  orgId: string,
  target: { contactId?: string; email?: string; domain?: string },
): Promise<boolean> {
  const ors: string[] = [];
  if (target.contactId) ors.push(`contact_id.eq.${target.contactId}`);
  if (target.email) ors.push(`email.ilike.${target.email}`);
  if (target.domain) ors.push(`domain.ilike.${target.domain}`);
  if (ors.length === 0) return false;

  const { data } = await loose(db)
    .from("do_not_contact")
    .select("id")
    .eq("organization_id", orgId)
    .or(ors.join(","))
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

// Full contactability check for a target, loading the CRM contact when a
// contactId is given and consulting the suppression list. Never throws; on a
// read error it fails CLOSED for suppression (treats an errored lookup as not
// suppressed only when there was nothing to match).
export async function checkContactable(
  db: SupabaseClient<Database>,
  orgId: string,
  target: { contactId?: string; email?: string; domain?: string },
): Promise<Contactability> {
  let contact: ContactComplianceState | null = null;
  let email = target.email?.toLowerCase();
  let domain = target.domain?.toLowerCase();

  if (target.contactId) {
    const { data } = await loose(db)
      .from("network_contacts")
      .select("communication_status, compliance_flags, email, company_domain")
      .eq("id", target.contactId)
      .eq("organization_id", orgId)
      .maybeSingle();
    if (data) {
      contact = { communication_status: data.communication_status, compliance_flags: data.compliance_flags };
      email = email ?? (data.email ? String(data.email).toLowerCase() : undefined);
      domain = domain ?? (data.company_domain ? String(data.company_domain).toLowerCase() : undefined);
    }
  }

  const suppressed = await isSuppressed(db, orgId, { contactId: target.contactId, email, domain });
  return evaluateContactability(contact, { suppressed });
}

export interface SuppressInput {
  contactId?: string;
  email?: string;
  domain?: string;
  scope?: "email" | "domain" | "contact";
  reason?: string;
  source?: string;
  addedBy?: string;
}

// Add a target to the do-not-contact list and mark any matching CRM contact as
// do_not_contact so it drops out of outbound immediately. Idempotent-ish: a
// duplicate suppression is harmless.
export async function suppressContact(
  db: SupabaseClient<Database>,
  orgId: string,
  input: SuppressInput,
): Promise<void> {
  const scope = input.scope ?? (input.contactId ? "contact" : input.domain && !input.email ? "domain" : "email");
  await loose(db).from("do_not_contact").insert({
    organization_id: orgId,
    scope,
    contact_id: input.contactId ?? null,
    email: input.email?.toLowerCase() ?? null,
    domain: input.domain?.toLowerCase() ?? null,
    reason: input.reason ?? null,
    source: input.source ?? "manual",
    added_by: input.addedBy ?? null,
  });

  if (input.contactId) {
    await loose(db)
      .from("network_contacts")
      .update({ communication_status: "do_not_contact" })
      .eq("id", input.contactId)
      .eq("organization_id", orgId);
  } else if (input.email) {
    await loose(db)
      .from("network_contacts")
      .update({ communication_status: "do_not_contact" })
      .eq("organization_id", orgId)
      .ilike("email", input.email);
  }
}

// Record an unsubscribe (or complaint/bounce) event and suppress the contact so
// no further outbound reaches them. Append-only event + suppression in one call.
export async function recordUnsubscribe(
  db: SupabaseClient<Database>,
  orgId: string,
  input: { contactId?: string; email?: string; campaignRef?: string; eventType?: "unsubscribe" | "complaint" | "bounce"; source?: string },
): Promise<void> {
  const eventType = input.eventType ?? "unsubscribe";
  await loose(db).from("unsubscribe_events").insert({
    organization_id: orgId,
    contact_id: input.contactId ?? null,
    email: input.email?.toLowerCase() ?? null,
    campaign_ref: input.campaignRef ?? null,
    event_type: eventType,
    source: input.source ?? null,
  });
  await suppressContact(db, orgId, {
    contactId: input.contactId,
    email: input.email,
    reason: eventType,
    source: eventType,
  });
}

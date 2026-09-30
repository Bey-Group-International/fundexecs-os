// lib/crm/identity-assurance.ts
// Whether a CRM entry's link to a person is something the app OBSERVED or
// something a sender ASSERTED.
//
// `is_system` says who wrote a row — the engine rather than a person. It does
// not say whether the engine had any grounds to believe the person it named was
// really involved, and those are different claims.
//
// A meeting entry is observed: the host built the invite list, or the person was
// in the room and the app watched them join. An inbound email entry is asserted:
// the address comes from the message's From header, which the sender wrote. The
// webhook signature proves the PROVIDER sent the delivery; it proves nothing
// about who the message says it is from. Absent SPF/DKIM/DMARC results — which
// the inbound payload this app reads does not carry — a forged From that happens
// to match a contact exactly would produce a row on that contact's permanent
// record, org-wide.
//
// This module does not stop that. It stops the record from CLAIMING more than it
// knows, which is the part that is fixable from here: a reader can see that the
// link rests on an address the sender supplied, and treat it accordingly.
//
// Pure: no database, no clock, no network.

/** The metadata value marking a link the sender asserted rather than one the app observed. */
export const IDENTITY_ASSERTED = "asserted";

/** The metadata key it is carried under. */
export const IDENTITY_KEY = "identity";

/**
 * True when this entry's link to the contact rests on an address somebody
 * supplied, rather than on something the app watched happen.
 *
 * Deliberately strict: anything other than the exact marker reads as "not
 * asserted", because the absence of the marker means an older row or an observed
 * one, and guessing from a near-miss value would be inventing provenance.
 * `metadata` is free-form jsonb, so it is read as unknown and narrowed.
 */
export function identityIsAsserted(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>)[IDENTITY_KEY] === IDENTITY_ASSERTED;
}

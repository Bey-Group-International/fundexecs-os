// lib/attestations.ts
// Phase 2 of the tokenization model (see docs/TOKENIZATION_LAYERS.md §5):
// immutable, signed assertions that a gated outcome genuinely occurred. An
// attestation is the security layer's unit — it is what makes reputation
// trustworthy, since verified closes (not self-reported status) are what mint
// standing. Rows are append-only and NEVER updated; a correction is a new
// attestation that supersedes, preserving the audit chain. The keystone event
// is recordDealClose: a verified close writes one 'closed' attestation AND mints
// close_verified reputation, exactly once (idempotent), in the trusted server
// context — the same service-client contract credits and reputation use.
import { createServiceClient } from "@/lib/supabase/server";
import { grantReputation, REPUTATION_POINTS } from "@/lib/reputation";
import type { Attestation, Deal } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

// What an attestation asserts. Keep in lockstep with the attestations.claim
// values referenced in migration 0048.
export type AttestationClaim =
  | "closed" // a deal reached a verified close (the keystone event)
  | "funded" // capital was secured/wired
  | "diligence_cleared"; // a diligence item was cleared/waived

export interface WriteAttestationInput {
  orgId: string;
  subjectType: string;
  subjectId: string;
  claim: AttestationClaim;
  /** The accountable principal who signed off. */
  attestedBy?: string | null;
  /** Optional counterparty / principal-tier witness org. */
  witnessOrgId?: string | null;
  /** Hash of the supporting record set, for later on-chain anchoring. */
  evidenceHash?: string | null;
}

// The subject_type / claim pairing for a whole-deal verified close. Pulled out
// as a constant so the write path and the idempotency check can never drift.
export const DEAL_CLOSE_SUBJECT = "deal_close";
export const DEAL_CLOSE_CLAIM: AttestationClaim = "closed";

/**
 * Pure mapping from input to the insert payload — no I/O, so it is unit-testable.
 * settlement and anchor_ref are intentionally omitted: the DB default ('internal')
 * applies, and nothing is anchored at write time. id / created_at are DB-assigned.
 */
export function buildAttestationRow(input: WriteAttestationInput): Partial<Attestation> {
  return {
    organization_id: input.orgId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    claim: input.claim,
    attested_by: input.attestedBy ?? null,
    witness_org_id: input.witnessOrgId ?? null,
    evidence_hash: input.evidenceHash ?? null,
  };
}

/**
 * Insert ONE immutable attestation row and return it. Append-only — never call
 * update on this table. Runs in the trusted server context (it writes, and may
 * write on behalf of a witness org an RLS client could not reach).
 */
export async function writeAttestation(
  service: ServiceClient,
  input: WriteAttestationInput,
): Promise<Attestation> {
  const { data, error } = await service
    .from("attestations")
    .insert(buildAttestationRow(input))
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Attestation;
}

/**
 * Whether an attestation already exists for this (subject_type, subject_id, claim).
 * The idempotency guard so a single close is never attested — or minted — twice.
 */
export async function hasAttestation(
  service: ServiceClient,
  subjectType: string,
  subjectId: string,
  claim: AttestationClaim,
): Promise<boolean> {
  const { data, error } = await service
    .from("attestations")
    .select("id")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId)
    .eq("claim", claim)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data != null;
}

/**
 * The keystone close → standing event. The single most important movement in the
 * whole model: it is where verified work becomes durable reputation.
 *
 * If no ('deal_close', deal.id, 'closed') attestation exists yet, write one and
 * THEN mint a close_verified reputation grant for the deal's org. If one already
 * exists, do nothing and return null — so re-running over the same ready close
 * (e.g. on every render of the closing hub) never double-attests or double-mints.
 */
export async function recordDealClose(
  service: ServiceClient,
  deal: Pick<Deal, "id" | "organization_id">,
): Promise<Attestation | null> {
  if (await hasAttestation(service, DEAL_CLOSE_SUBJECT, deal.id, DEAL_CLOSE_CLAIM)) {
    return null;
  }

  const attestation = await writeAttestation(service, {
    orgId: deal.organization_id,
    subjectType: DEAL_CLOSE_SUBJECT,
    subjectId: deal.id,
    claim: DEAL_CLOSE_CLAIM,
  });

  await grantReputation(
    service,
    deal.organization_id,
    REPUTATION_POINTS.close_verified,
    "close_verified",
    { sourceType: "deal", sourceId: deal.id },
  );

  return attestation;
}

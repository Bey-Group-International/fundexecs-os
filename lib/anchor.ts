// lib/anchor.ts
// Phase 4 of the tokenization model (see docs/TOKENIZATION_LAYERS.md §2.1, §5.2):
// the Security layer's on-chain BRIDGE. Attestations are the first — and lowest
// risk — unit we anchor (§2.1): they assert that something happened, they are not
// transferable value. Anchoring commits a hash of an attestation's claim-identifying
// fields so a third party can verify the row off-platform, while Postgres stays the
// authoritative store. There is no real chain yet, so anchoring is a pluggable
// abstraction (Anchorer) with a deterministic local default — a real chain anchorer
// drops in at the LocalAnchorer seam without touching any caller. Anchoring NEVER
// mutates an attestation's content; it only transitions settlement internal→anchored.
import { createHash } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import type { Attestation } from "@/lib/supabase/database.types";

type ServiceClient = ReturnType<typeof createServiceClient>;

// The stable, claim-identifying fields of an attestation — exactly what an
// evidence hash must commit to. Settlement metadata (settlement, anchor_ref) and
// DB-assigned fields (id, created_at) are deliberately excluded: they are not part
// of what the attestation asserts, and anchoring must be idempotent over them.
export interface AttestationContent {
  organization_id: string;
  subject_type: string;
  subject_id: string;
  claim: string;
  attested_by?: string | null;
  witness_org_id?: string | null;
}

/**
 * Deterministic canonical string for the claim-identifying fields — this is what
 * gets hashed. Keys are emitted in a fixed order (so input key order never matters)
 * and nullish values normalize to null, so a missing vs explicit-null field hash
 * the same. JSON over a hand-built array of [key, value] pairs keeps it unambiguous.
 */
export function canonicalAttestation(content: AttestationContent): string {
  const fields: Array<[string, string | null]> = [
    ["organization_id", content.organization_id],
    ["subject_type", content.subject_type],
    ["subject_id", content.subject_id],
    ["claim", content.claim],
    ["attested_by", content.attested_by ?? null],
    ["witness_org_id", content.witness_org_id ?? null],
  ];
  return JSON.stringify(fields);
}

/**
 * The evidence hash: sha256 of the canonical form, as hex. Pure and deterministic —
 * the same content always yields the same hash, and any change to an identifying
 * field yields a different one. This is the value committed on-chain when anchored.
 */
export function computeEvidenceHash(content: AttestationContent): string {
  return createHash("sha256").update(canonicalAttestation(content)).digest("hex");
}

/**
 * The on-chain bridge seam. An Anchorer takes an evidence hash and returns an
 * anchor_ref (a tx/Merkle reference) once the hash is committed. Swapping in a real
 * chain — Ethereum, a Merkle batcher, etc. — means implementing this one method;
 * callers (anchorAttestation) are unchanged.
 */
export interface Anchorer {
  anchor(evidenceHash: string): Promise<string>;
}

/**
 * The default, chain-free Anchorer. Returns a deterministic, verifiable stand-in
 * ref ("local:" + hash) — no external system, no randomness, so it is fully
 * reproducible in tests and dev. Replace with a real chain anchorer when the bridge
 * goes live (see §2.1); nothing else changes.
 */
export class LocalAnchorer implements Anchorer {
  async anchor(evidenceHash: string): Promise<string> {
    return `local:${evidenceHash}`;
  }
}

/**
 * Anchor a single attestation: commit its evidence hash via `anchorer` and record
 * the resulting ref, transitioning settlement internal→anchored. The attestation's
 * claim/subject content is NEVER touched — attestations are immutable in content;
 * only settlement metadata (settlement, anchor_ref, and the evidence_hash if it was
 * missing) is written. Idempotent: an already-anchored attestation is returned
 * unchanged. Runs in the trusted server context. Returns the updated Attestation.
 */
export async function anchorAttestation(
  service: ServiceClient,
  attestationId: string,
  anchorer: Anchorer = new LocalAnchorer(),
): Promise<Attestation> {
  const { data, error } = await service
    .from("attestations")
    .select("*")
    .eq("id", attestationId)
    .single();
  if (error) throw new Error(error.message);
  const attestation = data as Attestation;

  // Already anchored (or beyond) — nothing to do. Idempotent by design.
  if (attestation.settlement !== "internal") {
    return attestation;
  }

  // Every attestation should be born with a hash (see writeAttestation), but if an
  // older row predates that, recompute it from the row's own identifying fields.
  const evidenceHash = attestation.evidence_hash ?? computeEvidenceHash(attestation);
  const anchorRef = await anchorer.anchor(evidenceHash);

  const { data: updated, error: updateError } = await service
    .from("attestations")
    .update({
      settlement: "anchored",
      anchor_ref: anchorRef,
      evidence_hash: evidenceHash,
    })
    .eq("id", attestationId)
    .select("*")
    .single();
  if (updateError) throw new Error(updateError.message);
  return updated as Attestation;
}

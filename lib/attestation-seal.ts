// Trust layer (phase 3.1): tamper-evident sealing of verified artifacts.
//
// When an operator approval verifies an artifact, we seal it into the
// `attestations` rail (migration 0048) for tamper-evidence: a deterministic
// SHA-256 over the artifact's salient content + sources + verification decision
// becomes the `evidence_hash` of an immutable attestation row. Any later change
// to the sealed output yields a different hash, so the integrity of a verified
// output is provable. Today every seal settles `internal`; the same hash is the
// rail for later 'anchored'/'onchain' settlement (third-party verifiability).
//
// Everything here is pure (no I/O) so it is trivially testable and the engine
// can seal best-effort without coupling to a client.
import { createHash } from "crypto";
import type { Attestation } from "@/lib/supabase/database.types";

/**
 * The salient fields that define a verified artifact's integrity. Hashing only
 * these (rather than the whole row) keeps the seal stable across incidental
 * column changes while still covering everything an operator actually signed off.
 */
export interface ArtifactHashInput {
  content: string;
  sources: unknown;
  verification_status: string;
  verified_by: string | null;
  verified_at: string | null;
}

/**
 * Stable, key-sorted JSON. `JSON.stringify` preserves insertion order, so we
 * sort object keys recursively to guarantee the same logical value always
 * serializes to the same string — the precondition for a deterministic hash.
 */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Deterministic SHA-256 hex digest of an artifact's verified integrity. Same
 * input → same hash; any change to content, sources, or the verification
 * decision → different hash.
 */
export function computeArtifactHash(input: ArtifactHashInput): string {
  const canonical = canonicalize({
    content: input.content,
    sources: input.sources,
    verification_status: input.verification_status,
    verified_by: input.verified_by,
    verified_at: input.verified_at,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The integrity verdict for a sealed artifact, derived by recomputing its hash:
 * - "sealed"    — the artifact's current integrity matches its seal (intact).
 * - "tampered"  — the seal exists but no longer matches (the signed content changed).
 * - "unsealed"  — no seal was ever written (nothing to verify against).
 */
export type SealStatus = "sealed" | "tampered" | "unsealed";

/**
 * Re-check a seal: recompute the artifact's hash and compare it to the stored
 * `evidence_hash`. This is what makes the "tamper-evident" promise real — the
 * write-only seal becomes verifiable by recomputing it on read. Pure (no I/O).
 */
export function verifyArtifactSeal(
  input: ArtifactHashInput,
  evidenceHash: string | null | undefined,
): SealStatus {
  if (!evidenceHash) return "unsealed";
  return computeArtifactHash(input) === evidenceHash ? "sealed" : "tampered";
}

export interface BuildArtifactAttestationArgs {
  artifactId: string;
  organizationId: string;
  attestedBy: string | null;
  hashInput: ArtifactHashInput;
}

/**
 * The row to insert into `attestations` to seal a verified artifact. Pure: the
 * caller owns the actual insert. `claim: 'verified'` and `settlement: 'internal'`
 * mirror the schema's check constraints (migration 0048).
 */
export type ArtifactAttestationRow = Pick<
  Attestation,
  "subject_type" | "subject_id" | "claim" | "evidence_hash" | "settlement" | "attested_by" | "organization_id"
>;

export function buildArtifactAttestation(args: BuildArtifactAttestationArgs): ArtifactAttestationRow {
  return {
    subject_type: "artifact",
    subject_id: args.artifactId,
    claim: "verified",
    evidence_hash: computeArtifactHash(args.hashInput),
    settlement: "internal",
    attested_by: args.attestedBy,
    organization_id: args.organizationId,
  };
}

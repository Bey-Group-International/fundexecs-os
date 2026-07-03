// lib/artifact-seal.ts
// The READ side of tamper-evidence. verifyArtifact (lib/engine.ts)
// writes a SHA-256 seal into the `attestations` rail when an operator verifies
// an artifact; this module recomputes that hash on read and reports whether each
// sealed artifact is still intact. Best-effort and fully defensive: a query
// failure yields an empty map rather than ever throwing — surfacing the seal is
// additive trust, never a gate on the load path.
import type { createServerClient } from "@/lib/supabase/server";
import type { Artifact } from "@/lib/supabase/database.types";
import { verifyArtifactSeal, type ArtifactHashInput, type SealStatus } from "@/lib/attestation-seal";

type ServerClient = ReturnType<typeof createServerClient>;

// The salient verification fields the seal was computed over (see
// attestation-seal.ts). Must mirror exactly what verifyArtifact hashed.
function hashInputFromArtifact(a: Artifact): ArtifactHashInput {
  return {
    content: a.content ?? "",
    sources: a.sources ?? null,
    verification_status: a.verification_status,
    verified_by: a.verified_by,
    verified_at: a.verified_at,
  };
}

/**
 * For the given artifacts, recompute each seal and return the verdict per
 * artifact id. Queries `attestations` for the sealing rows
 * (subject_type='artifact', claim='verified') over these subject ids, takes the
 * latest seal per artifact, and re-checks it against the artifact's current
 * integrity. Artifacts with no seal are simply absent from the map ("unsealed"
 * to callers). Any failure returns an empty map — never throws.
 */
export async function loadArtifactSealStatuses(
  supabase: ServerClient,
  artifacts: Artifact[],
): Promise<Map<string, SealStatus>> {
  const result = new Map<string, SealStatus>();
  const ids = artifacts.map((a) => a.id);
  if (ids.length === 0) return result;

  try {
    const { data, error } = await supabase
      .from("attestations")
      .select("subject_id, evidence_hash, created_at")
      .eq("subject_type", "artifact")
      .eq("claim", "verified")
      .in("subject_id", ids)
      .order("created_at", { ascending: false });
    if (error || !data) return result;

    // Latest seal per artifact — rows arrive newest-first, so first seen wins.
    const latestHash = new Map<string, string | null>();
    for (const row of data as { subject_id: string; evidence_hash: string | null }[]) {
      if (!latestHash.has(row.subject_id)) latestHash.set(row.subject_id, row.evidence_hash);
    }

    for (const artifact of artifacts) {
      const evidenceHash = latestHash.get(artifact.id);
      if (evidenceHash === undefined) continue; // never sealed
      result.set(artifact.id, verifyArtifactSeal(hashInputFromArtifact(artifact), evidenceHash));
    }
  } catch {
    return new Map<string, SealStatus>();
  }

  return result;
}

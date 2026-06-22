// lib/attestation-seal.test.ts
// Unit tests for the PURE tamper-evident sealing helpers (no database). These
// pin down the determinism contract the trust layer relies on: identical input
// always hashes the same, any tamper (content/sources/status) yields a different
// hash, and the sealing attestation row maps onto the 0048 schema exactly.
import {
  computeArtifactHash,
  buildArtifactAttestation,
  verifyArtifactSeal,
  type ArtifactHashInput,
  type BuildArtifactAttestationArgs,
} from "@/lib/attestation-seal";

function hashInput(overrides: Partial<ArtifactHashInput> = {}): ArtifactHashInput {
  return {
    content: "The quarterly memo, signed off.",
    sources: [{ source: "doc-1", snippet: "fact", score: 0.9, kind: "doc" }],
    verification_status: "verified",
    verified_by: "principal-1",
    verified_at: "2026-06-22T00:00:00.000Z",
    ...overrides,
  };
}

function buildArgs(overrides: Partial<BuildArtifactAttestationArgs> = {}): BuildArtifactAttestationArgs {
  return {
    artifactId: "artifact-1",
    organizationId: "org-1",
    attestedBy: "principal-1",
    hashInput: hashInput(),
    ...overrides,
  };
}

describe("computeArtifactHash", () => {
  it("is deterministic — same input yields the same hash", () => {
    expect(computeArtifactHash(hashInput())).toBe(computeArtifactHash(hashInput()));
  });

  it("returns a SHA-256 hex digest (64 hex chars)", () => {
    expect(computeArtifactHash(hashInput())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of object key order in sources (canonicalized)", () => {
    const a = computeArtifactHash(hashInput({ sources: { a: 1, b: 2 } }));
    const b = computeArtifactHash(hashInput({ sources: { b: 2, a: 1 } }));
    expect(a).toBe(b);
  });

  it("changes when content is tampered with", () => {
    const before = computeArtifactHash(hashInput());
    const after = computeArtifactHash(hashInput({ content: "Edited after the fact." }));
    expect(after).not.toBe(before);
  });

  it("changes when sources are tampered with", () => {
    const before = computeArtifactHash(hashInput());
    const after = computeArtifactHash(hashInput({ sources: [{ source: "doc-2" }] }));
    expect(after).not.toBe(before);
  });

  it("changes when the verification decision changes", () => {
    const before = computeArtifactHash(hashInput());
    expect(computeArtifactHash(hashInput({ verification_status: "unverified" }))).not.toBe(before);
    expect(computeArtifactHash(hashInput({ verified_by: "principal-2" }))).not.toBe(before);
    expect(computeArtifactHash(hashInput({ verified_at: "2026-06-23T00:00:00.000Z" }))).not.toBe(before);
  });

  it("treats null and empty sources as distinct, stable values", () => {
    const nullHash = computeArtifactHash(hashInput({ sources: null }));
    expect(nullHash).toBe(computeArtifactHash(hashInput({ sources: null })));
    expect(nullHash).not.toBe(computeArtifactHash(hashInput({ sources: [] })));
  });
});

describe("verifyArtifactSeal", () => {
  it("returns 'sealed' when the input still matches its evidence hash", () => {
    const input = hashInput();
    const seal = computeArtifactHash(input);
    expect(verifyArtifactSeal(input, seal)).toBe("sealed");
  });

  it("returns 'tampered' when the content was changed after sealing", () => {
    const seal = computeArtifactHash(hashInput());
    expect(verifyArtifactSeal(hashInput({ content: "Edited after the fact." }), seal)).toBe("tampered");
  });

  it("returns 'tampered' when the sources were changed after sealing", () => {
    const seal = computeArtifactHash(hashInput());
    expect(verifyArtifactSeal(hashInput({ sources: [{ source: "doc-2" }] }), seal)).toBe("tampered");
  });

  it("returns 'tampered' when the verifier was changed after sealing", () => {
    const seal = computeArtifactHash(hashInput());
    expect(verifyArtifactSeal(hashInput({ verified_by: "principal-2" }), seal)).toBe("tampered");
  });

  it("returns 'unsealed' when there is no evidence hash", () => {
    expect(verifyArtifactSeal(hashInput(), null)).toBe("unsealed");
    expect(verifyArtifactSeal(hashInput(), undefined)).toBe("unsealed");
    expect(verifyArtifactSeal(hashInput(), "")).toBe("unsealed");
  });
});

describe("buildArtifactAttestation", () => {
  it("maps onto the attestations schema for an internal artifact seal", () => {
    const row = buildArtifactAttestation(buildArgs());
    expect(row).toEqual({
      subject_type: "artifact",
      subject_id: "artifact-1",
      claim: "verified",
      evidence_hash: computeArtifactHash(hashInput()),
      settlement: "internal",
      attested_by: "principal-1",
      organization_id: "org-1",
    });
  });

  it("carries the deterministic hash of the supplied verification input", () => {
    const row = buildArtifactAttestation(buildArgs());
    expect(row.evidence_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.evidence_hash).toBe(computeArtifactHash(hashInput()));
  });

  it("allows a null attester (e.g. system-verified)", () => {
    const row = buildArtifactAttestation(buildArgs({ attestedBy: null }));
    expect(row.attested_by).toBeNull();
  });
});

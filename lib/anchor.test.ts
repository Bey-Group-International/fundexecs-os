// lib/anchor.test.ts
// Unit tests for the pure anchoring primitives (no database). These pin down the
// guarantees the on-chain bridge relies on (§2.1): the evidence hash is a stable,
// content-only fingerprint — deterministic, order-independent, and sensitive to any
// identifying field — and the default anchorer is a verifiable, reproducible stand-in.
import {
  canonicalAttestation,
  computeEvidenceHash,
  LocalAnchorer,
  type AttestationContent,
} from "@/lib/anchor";

function content(overrides: Partial<AttestationContent> = {}): AttestationContent {
  return {
    organization_id: "org-1",
    subject_type: "deal_close",
    subject_id: "deal-1",
    claim: "closed",
    attested_by: "principal-1",
    witness_org_id: "org-2",
    ...overrides,
  };
}

describe("computeEvidenceHash", () => {
  it("is deterministic for identical content", () => {
    expect(computeEvidenceHash(content())).toBe(computeEvidenceHash(content()));
  });

  it("returns a 64-char hex sha256 digest", () => {
    expect(computeEvidenceHash(content())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any identifying field changes", () => {
    const base = computeEvidenceHash(content());
    expect(computeEvidenceHash(content({ organization_id: "org-X" }))).not.toBe(base);
    expect(computeEvidenceHash(content({ subject_type: "diligence_item" }))).not.toBe(base);
    expect(computeEvidenceHash(content({ subject_id: "deal-2" }))).not.toBe(base);
    expect(computeEvidenceHash(content({ claim: "funded" }))).not.toBe(base);
    expect(computeEvidenceHash(content({ attested_by: "principal-2" }))).not.toBe(base);
    expect(computeEvidenceHash(content({ witness_org_id: "org-9" }))).not.toBe(base);
  });

  it("treats a missing optional field and an explicit null as identical", () => {
    const withNull = content({ attested_by: null, witness_org_id: null });
    const withUndefined: AttestationContent = {
      organization_id: "org-1",
      subject_type: "deal_close",
      subject_id: "deal-1",
      claim: "closed",
    };
    expect(computeEvidenceHash(withUndefined)).toBe(computeEvidenceHash(withNull));
  });
});

describe("canonicalAttestation", () => {
  it("is independent of input key order", () => {
    const ordered: AttestationContent = {
      organization_id: "org-1",
      subject_type: "deal_close",
      subject_id: "deal-1",
      claim: "closed",
      attested_by: "principal-1",
      witness_org_id: "org-2",
    };
    // Same data, keys supplied in a different order.
    const shuffled: AttestationContent = {
      witness_org_id: "org-2",
      claim: "closed",
      subject_id: "deal-1",
      attested_by: "principal-1",
      subject_type: "deal_close",
      organization_id: "org-1",
    };
    expect(canonicalAttestation(shuffled)).toBe(canonicalAttestation(ordered));
  });
});

describe("LocalAnchorer", () => {
  it("returns a 'local:'-prefixed ref over the evidence hash", async () => {
    const hash = computeEvidenceHash(content());
    await expect(new LocalAnchorer().anchor(hash)).resolves.toBe(`local:${hash}`);
  });
});

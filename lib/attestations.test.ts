// lib/attestations.test.ts
// Unit tests for the PURE attestation helpers (no database). These pin down the
// insert-payload mapping and the deal-close subject/claim contract that the
// idempotency guard and the write path both depend on — so the keystone close
// event can never silently start writing the wrong row.
import {
  buildAttestationRow,
  DEAL_CLOSE_SUBJECT,
  DEAL_CLOSE_CLAIM,
  type WriteAttestationInput,
} from "@/lib/attestations";

function input(overrides: Partial<WriteAttestationInput> = {}): WriteAttestationInput {
  return {
    orgId: "org-1",
    subjectType: "deal_close",
    subjectId: "deal-1",
    claim: "closed",
    ...overrides,
  };
}

describe("buildAttestationRow", () => {
  it("maps the input fields onto the insert payload", () => {
    const row = buildAttestationRow(
      input({ attestedBy: "principal-1", witnessOrgId: "org-2", evidenceHash: "0xabc" }),
    );
    expect(row).toEqual({
      organization_id: "org-1",
      subject_type: "deal_close",
      subject_id: "deal-1",
      claim: "closed",
      attested_by: "principal-1",
      witness_org_id: "org-2",
      evidence_hash: "0xabc",
    });
  });

  it("defaults the optional signer/witness/evidence fields to null", () => {
    const row = buildAttestationRow(input());
    expect(row.attested_by).toBeNull();
    expect(row.witness_org_id).toBeNull();
    expect(row.evidence_hash).toBeNull();
  });

  it("lets the DB default own settlement and assign id/created_at", () => {
    // Omitting these is what keeps rows immutable & internal-by-default: the
    // write path must never set settlement, anchor_ref, id, or created_at.
    const row = buildAttestationRow(input());
    expect(row.settlement).toBeUndefined();
    expect(row.anchor_ref).toBeUndefined();
    expect(row.id).toBeUndefined();
    expect(row.created_at).toBeUndefined();
  });
});

describe("deal-close contract", () => {
  it("attests a whole-deal close as ('deal_close', 'closed')", () => {
    expect(DEAL_CLOSE_SUBJECT).toBe("deal_close");
    expect(DEAL_CLOSE_CLAIM).toBe("closed");
  });

  it("the deal-close subject/claim build a well-formed row", () => {
    const row = buildAttestationRow(
      input({ subjectType: DEAL_CLOSE_SUBJECT, claim: DEAL_CLOSE_CLAIM }),
    );
    expect(row.subject_type).toBe("deal_close");
    expect(row.claim).toBe("closed");
  });
});

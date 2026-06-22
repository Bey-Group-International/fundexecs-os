// lib/integrations/dispatch-guard.test.ts
// The trust layer's pre-flight guard: dispatchAction refuses a Tier-2/3 send of
// an unverified, weakly-grounded backing artifact before it reaches a
// counterparty. Internal (Tier 1) work and actions with no backing artifact are
// untouched — they dispatch on the normal path.
import { dispatchAction } from "@/lib/integrations";
import { GROUNDING_THRESHOLD } from "@/lib/grounding";

// Below the grounding threshold and never operator-signed → not verifiable.
const UNVERIFIABLE = { verification_status: "unverified", grounding_score: 0 };
// Operator-signed → verifiable regardless of score.
const VERIFIED = { verification_status: "verified", grounding_score: 0 };
// Well-grounded above the threshold → verifiable without a sign-off.
const WELL_GROUNDED = {
  verification_status: "unverified",
  grounding_score: GROUNDING_THRESHOLD + 0.1,
};

describe("dispatchAction trust pre-flight guard", () => {
  it("blocks a Tier-2 send of an unverifiable backing artifact", async () => {
    const result = await dispatchAction({
      orgId: "org-1",
      actorId: "user-1",
      action: "send_outreach", // Tier 2
      target: { name: "Acme LP" },
      backingArtifact: UNVERIFIABLE,
    });

    expect(result.ok).toBe(false);
    expect(result.gated).toBe(true);
    expect(result.live).toBe(false);
    expect(result.detail).toMatch(/trust gate/i);
  });

  it("blocks a Tier-3 send of an unverifiable backing artifact", async () => {
    const result = await dispatchAction({
      orgId: "org-1",
      actorId: "user-1",
      action: "submit_term_sheet", // Tier 3
      backingArtifact: UNVERIFIABLE,
    });

    expect(result.ok).toBe(false);
    expect(result.gated).toBe(true);
  });

  it("allows a Tier-2 send when the backing artifact is operator-verified", async () => {
    const result = await dispatchAction({
      orgId: "org-1",
      actorId: "user-1",
      action: "send_outreach",
      backingArtifact: VERIFIED,
    });

    expect(result.gated).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("allows a Tier-2 send when the backing artifact is well-grounded", async () => {
    const result = await dispatchAction({
      orgId: "org-1",
      actorId: "user-1",
      action: "send_outreach",
      backingArtifact: WELL_GROUNDED,
    });

    expect(result.gated).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("never gates a Tier-1 action, even with an unverifiable artifact", async () => {
    const result = await dispatchAction({
      orgId: "org-1",
      actorId: "user-1",
      action: "draft_reply", // Tier 1 — internal prep
      backingArtifact: UNVERIFIABLE,
    });

    expect(result.gated).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it("is a no-op when no backing artifact is supplied (no regression)", async () => {
    const result = await dispatchAction({
      orgId: "org-1",
      actorId: "user-1",
      action: "send_outreach", // Tier 2, but nothing backs it
      target: { name: "Acme LP" },
    });

    expect(result.gated).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});

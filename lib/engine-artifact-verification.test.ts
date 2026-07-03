// Coverage for the artifact-verification honesty fix: verification_status
// used to flip to "verified" (and get sealed into the attestations rail) as
// an automatic side effect of approving a workflow's PLAN — before any
// artifact even existed for the operator to review. verifyArtifact is now
// the ONLY path to "verified", operating on exactly one artifact by id, and
// is only ever invoked from an explicit operator action taken after they can
// see the artifact's actual content.

jest.mock("@/lib/identity", () => ({ isPrincipalIdentityVerified: jest.fn() }));
jest.mock("@/lib/reputation", () => ({
  grantReputation: jest.fn(),
  REPUTATION_POINTS: { artifact_verified: 10 },
}));

const serviceFrom = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: jest.fn(),
  createServiceClient: () => ({ from: (...a: unknown[]) => serviceFrom(...a) }),
}));

import { verifyArtifact } from "./engine";
import { isPrincipalIdentityVerified } from "@/lib/identity";
import { grantReputation } from "@/lib/reputation";

const mockIsVerified = isPrincipalIdentityVerified as jest.Mock;
const mockGrantReputation = grantReputation as jest.Mock;

const ARTIFACT_ROW = {
  id: "art-1",
  workflow_id: "wf-1",
  hub: "run",
  artifact_type: "ic_memo",
  content: "The deal looks strong.",
  sources: null,
  verification_status: "unverified",
  grounding_score: 0.8,
};

// A chainable Supabase stub: .select/.update/.insert/.eq/.maybeSingle/.single
// all chain; maybeSingle/single resolve to caller-supplied results keyed by op.
function makeSupabase(opts: {
  fetchRow?: typeof ARTIFACT_ROW | null;
  fetchError?: { message: string } | null;
  updateClaimsRow?: boolean;
  updateError?: { message: string } | null;
  sealInsertResult?: { id: string } | null;
}) {
  const inserted: Record<string, unknown>[] = [];
  const eventsInserted: Record<string, unknown>[] = [];

  function artifactsBuilder() {
    // .select() is also called (for its return shape) after .update() in the
    // real chain — only .update() itself flips this, so a trailing .select()
    // doesn't make an update look like a fetch.
    let mutated = false;
    const b: Record<string, unknown> = {
      select: () => b,
      update: () => {
        mutated = true;
        return b;
      },
      eq: () => b,
      maybeSingle: async () => {
        if (!mutated) return { data: opts.fetchRow ?? null, error: opts.fetchError ?? null };
        return {
          data: opts.updateClaimsRow === false ? null : { id: ARTIFACT_ROW.id },
          error: opts.updateError ?? null,
        };
      },
    };
    return b;
  }

  function attestationsBuilder() {
    const b: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => {
        inserted.push(row);
        return b;
      },
      select: () => b,
      single: async () => ({ data: opts.sealInsertResult ?? { id: "attest-1" }, error: null }),
    };
    return b;
  }

  function taskEventsBuilder() {
    const b: Record<string, unknown> = {
      insert: (row: Record<string, unknown>) => {
        eventsInserted.push(row);
        return Promise.resolve({ data: null, error: null });
      },
    };
    return b;
  }

  const client = {
    from: (table: string) => {
      if (table === "artifacts") return artifactsBuilder();
      if (table === "attestations") return attestationsBuilder();
      if (table === "task_events") return taskEventsBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client, inserted, eventsInserted };
}

const ctx = (client: unknown) => ({ supabase: client, orgId: "org-1", actorId: "user-1" }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockIsVerified.mockResolvedValue(true);
  mockGrantReputation.mockResolvedValue(undefined);
});

describe("verifyArtifact", () => {
  it("rejects when the artifact doesn't exist (or isn't in this org)", async () => {
    const { client } = makeSupabase({ fetchRow: null });
    const result = await verifyArtifact(ctx(client), "art-missing", "Looks right");
    expect(result).toEqual({ ok: false, error: "Artifact not found." });
  });

  it("surfaces a fetch error instead of silently failing", async () => {
    const { client } = makeSupabase({ fetchRow: null, fetchError: { message: "db down" } });
    const result = await verifyArtifact(ctx(client), "art-1", "note");
    expect(result).toEqual({ ok: false, error: "db down" });
  });

  it("no-ops when the artifact is already verified", async () => {
    const { client, inserted } = makeSupabase({ fetchRow: { ...ARTIFACT_ROW, verification_status: "verified" } });
    const result = await verifyArtifact(ctx(client), "art-1", "note");
    expect(result).toEqual({ ok: true });
    expect(inserted).toHaveLength(0);
  });

  it("verifies, seals, and records events for a genuinely unverified artifact", async () => {
    const { client, inserted, eventsInserted } = makeSupabase({ fetchRow: ARTIFACT_ROW });

    const result = await verifyArtifact(ctx(client), "art-1", "Reviewed — figures check out");

    expect(result).toEqual({ ok: true });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ subject_type: "artifact", subject_id: "art-1", claim: "verified" });
    expect(eventsInserted.map((e) => e.event_type)).toEqual(["artifact.verified", "artifact.sealed"]);
  });

  it("grants grounding-weighted reputation only when the verifying principal is identity-verified", async () => {
    const { client } = makeSupabase({ fetchRow: ARTIFACT_ROW });
    await verifyArtifact(ctx(client), "art-1", "note");
    expect(mockGrantReputation).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      8, // round(10 * 0.8)
      "artifact_verified",
      expect.objectContaining({ sourceType: "artifact", sourceId: "art-1" }),
    );

    mockGrantReputation.mockClear();
    mockIsVerified.mockResolvedValue(false);
    const { client: client2 } = makeSupabase({ fetchRow: ARTIFACT_ROW });
    await verifyArtifact(ctx(client2), "art-1", "note");
    expect(mockGrantReputation).not.toHaveBeenCalled();
  });

  it("no-ops without sealing when a concurrent verify already claimed the row", async () => {
    const { client, inserted } = makeSupabase({ fetchRow: ARTIFACT_ROW, updateClaimsRow: false });
    const result = await verifyArtifact(ctx(client), "art-1", "note");
    expect(result).toEqual({ ok: true });
    expect(inserted).toHaveLength(0);
  });

  it("surfaces an update error instead of silently failing", async () => {
    const { client } = makeSupabase({ fetchRow: ARTIFACT_ROW, updateError: { message: "update failed" } });
    const result = await verifyArtifact(ctx(client), "art-1", "note");
    expect(result).toEqual({ ok: false, error: "update failed" });
  });
});

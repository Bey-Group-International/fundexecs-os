jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

let session: Record<string, unknown> | null;
let pass = true;
let updated: Record<string, unknown> | null = null;
let updateError: { code: string; message: string } | null = null;
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        update: (row: Record<string, unknown>) => ((updated = row), q),
        eq: () => q,
        then: (resolve: (v: unknown) => void) => resolve({ error: updateError }),
      };
      return q;
    },
  }),
}));
jest.mock("@/lib/lp-access.server", () => ({ getLinkSession: async () => session, hasLpPass: async () => pass }));

import { confirmCapitalCommitmentAction, signSubscriptionAction } from "./actions";

const approved = (over: Record<string, unknown> = {}) => ({ id: "s1", status: "accreditation", review_state: "approved", ...over });

beforeEach(() => {
  session = approved();
  pass = true;
  updated = null;
  updateError = null;
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  ["signSubscriptionAction", signSubscriptionAction, "accreditation", { status: "subscription" }],
  ["confirmCapitalCommitmentAction", confirmCapitalCommitmentAction, "subscription", { status: "committed" }],
] as const)("%s", (_n, action, stage, expected) => {
  it("moves an approved LP on", async () => {
    session = approved({ status: stage });
    expect(await action("tok")).toEqual({ ok: true });
    expect(updated).toMatchObject(expected);
  });

  it.each(["not_started", "in_progress", "submitted", "changes_requested", "rejected"])("refuses an LP who is %s, whatever the link says", async (state) => {
    session = approved({ status: stage, review_state: state });
    expect(await action("tok")).toEqual({ error: "Invalid or expired link" });
    expect(updated).toBeNull();
  });

  it("refuses without the code pass", async () => {
    session = approved({ status: stage });
    pass = false;
    expect(await action("tok")).toEqual({ error: "Invalid or expired link" });
    expect(updated).toBeNull();
  });

  it("refuses an unknown link and a completed onboarding", async () => {
    session = null;
    expect(await action("tok")).toEqual({ error: "Invalid or expired link" });
    session = approved({ status: "complete" });
    expect(await action("tok")).toEqual({ error: "Invalid or expired link" });
    expect(updated).toBeNull();
  });

  it("will not skip a step", async () => {
    session = approved({ status: "pending" });
    expect(await action("tok")).toMatchObject({ error: expect.stringContaining("Not at") });
    expect(updated).toBeNull();
  });

  it("hides a database error", async () => {
    session = approved({ status: stage });
    updateError = { code: "x", message: "boom" };
    expect(await action("tok")).toEqual({ error: expect.stringContaining("Failed to save") });
  });
});

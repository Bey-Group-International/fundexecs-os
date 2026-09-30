/**
 * Fulfillment must grant exactly once, and must never report success without
 * granting.
 *
 * Regression test for a bug that reached production and gave real credits away.
 * Fulfillment has two callers — the browser's return redirect
 * (/api/stripe/return) and the Stripe webhook — and adding the webhook made
 * them concurrent for the first time. The very first live purchase was
 * fulfilled by both within 7ms and granted its 500-credit pack twice, because
 * the guard read `status` and then acted on it: both callers read "pending".
 *
 * The concurrency case drives two OVERLAPPING calls against one store, because
 * two sequential ones passed even with the bug. The remaining cases cover the
 * other half of the contract: a claim that could not be taken must not be
 * reported as "already fulfilled", or the grant is dropped and the webhook is
 * told to stop retrying.
 */

const grants: string[] = [];

// Claims live in processed_stripe_events (a bare text primary key). The one
// property that matters: a second insert of the same id conflicts, so only the
// first caller gets a row back.
const claims = new Map<string, string>(); // id -> created_at ISO
let claimFails = false;
let completionReadFails = false;
let releaseFails = false;
let grantThrows = false;
const grantRefs: (string | null)[] = [];
// Simulates the holder finishing mid-recovery: the completion marker is absent
// on the first read and present on the next.
let completesDuringRecovery = false;
let completionReads = 0;

// The checkout audit row. Absent for invoice kinds, which the `kind` CHECK
// (plan|pack|gift) cannot store at all.
let checkoutRow: { status: string } | null = null;

function table(name: string) {
  if (name === "processed_stripe_events") {
    return {
      upsert: (row: { id: string }) => {
        const apply = () => {
          if (claimFails) return { data: null, error: { message: "db down" } };
          if (claims.has(row.id)) return { data: [], error: null };
          claims.set(row.id, new Date().toISOString());
          return { data: [{ id: row.id }], error: null };
        };
        // Awaited directly (completion marker) or via .select() (the claim).
        return {
          select: async () => apply(),
          then: (resolve: (v: unknown) => void) => resolve(apply()),
        };
      },
      select: (cols?: string) => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => {
            // The staleness read asks for created_at; the completion read does not.
            if (cols?.includes("created_at")) {
              const at = claims.get(id);
              return { data: at ? { id, created_at: at } : null, error: null };
            }
            if (completionReadFails) return { data: null, error: { message: "db down" } };
            if (completesDuringRecovery && id.startsWith("fulfilled:")) {
              completionReads += 1;
              // Absent to the caller's own check, present by the time the
              // release re-reads it — the window the re-read exists to cover.
              return { data: completionReads > 1 ? { id } : null, error: null };
            }
            return { data: claims.has(id) ? { id } : null, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async (_c: string, id: string) => {
          if (releaseFails) return { error: { message: "db down" } };
          claims.delete(id);
          return { error: null };
        },
      }),
    };
  }
  if (name === "stripe_checkouts") {
    return {
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: checkoutRow }) }),
      }),
      update: (patch: { status?: string }) => ({
        eq: async () => {
          if (checkoutRow && patch.status) checkoutRow.status = patch.status;
          return { error: null };
        },
      }),
    };
  }
  return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    insert: async () => ({ error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
    upsert: async () => ({ data: [], error: null }),
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: (n: string) => table(n) }),
}));

const retrieve = jest.fn(async () => ({
  id: "cs_live_race",
  payment_status: "paid",
  status: "complete",
  metadata: { org_id: "org_1", kind: "pack", pack_key: "pack_500" },
  customer: null,
  payment_intent: "pi_1",
}));
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({ checkout: { sessions: { retrieve } } })),
);

jest.mock("@/lib/purchase", () => ({
  addPack: jest.fn(async (_s: unknown, _o: string, _k: string, opts?: { reference?: string | null }) => {
    if (grantThrows) throw new Error("grant blew up");
    grants.push("pack_500");
    grantRefs.push(opts?.reference ?? null);
    return { ok: true };
  }),
}));

import { fulfillCheckout } from "./stripe";

beforeEach(() => {
  grants.length = 0;
  grantRefs.length = 0;
  claims.clear();
  claimFails = false;
  completionReadFails = false;
  releaseFails = false;
  grantThrows = false;
  completesDuringRecovery = false;
  completionReads = 0;
  checkoutRow = { status: "pending" };
  process.env.STRIPE_SECRET_KEY = "sk_live_test_fixture";
});

it("grants once when the webhook and the return redirect arrive together", async () => {
  const [a, b] = await Promise.all([
    fulfillCheckout("cs_live_race"),
    fulfillCheckout("cs_live_race"),
  ]);

  expect(grants).toHaveLength(1);
  // The winner succeeds; the loser must not surface an error to a buyer whose
  // payment genuinely went through, nor claim to have granted anything.
  const winner = [a, b].find((r) => r.ok);
  const loser = [a, b].find((r) => !r.ok);
  expect(winner?.ok).toBe(true);
  // The loser lost the race, not the payment: it reports retryable-but-underway
  // so the webhook redelivers, while the buyer's redirect still reads success.
  expect(loser?.inProgress).toBe(true);
  expect(checkoutRow?.status).toBe("fulfilled");
});

it("grants once when the same session is fulfilled twice in sequence", async () => {
  await fulfillCheckout("cs_live_race");
  await fulfillCheckout("cs_live_race");
  expect(grants).toHaveLength(1);
});

it("reports failure, not success, when the claim cannot be taken", async () => {
  claimFails = true;
  const res = await fulfillCheckout("cs_live_race");

  // The dangerous outcome is ok:true — it drops the grant and tells the webhook
  // to stop redelivering, so the buyer pays and receives nothing.
  expect(res.ok).toBe(false);
  expect(res.alreadyFulfilled).toBeUndefined();
  expect(grants).toHaveLength(0);
});

it("keeps retrying while another caller is mid-fulfillment", async () => {
  // Claim held, but the checkout is still pending: the holder has not finished.
  claims.set("fulfill:cs_live_race", new Date().toISOString());
  const res = await fulfillCheckout("cs_live_race");

  expect(res.ok).toBe(false);
  expect(res.alreadyFulfilled).toBeUndefined();
  expect(grants).toHaveLength(0);
});

it("reports already-fulfilled once the holder has finished", async () => {
  claims.set("fulfill:cs_live_race", new Date().toISOString());
  claims.set("fulfilled:cs_live_race", new Date().toISOString()); // the completion marker is the evidence
  const res = await fulfillCheckout("cs_live_race");

  expect(res.ok).toBe(true);
  expect(res.alreadyFulfilled).toBe(true);
  expect(grants).toHaveLength(0);
});

it("keeps retrying an unfinished invoice checkout, which never has an audit row", async () => {
  // The claim is held and nothing has completed. Answering from the audit row
  // would say "done" here, because an invoice kind cannot have one — which is
  // exactly how a paid invoice would be left unsettled in silence.
  claims.set("fulfill:cs_live_race", new Date().toISOString());
  checkoutRow = null;
  const res = await fulfillCheckout("cs_live_race");

  expect(res.ok).toBe(false);
  expect(res.alreadyFulfilled).toBeUndefined();
});

it("does not call an unreadable completion state success", async () => {
  claims.set("fulfill:cs_live_race", new Date().toISOString());
  claims.set("fulfilled:cs_live_race", new Date().toISOString());
  completionReadFails = true;
  const res = await fulfillCheckout("cs_live_race");

  // "We could not tell" must never read as "yes": that stops the webhook
  // redelivering and the purchase is lost.
  expect(res.ok).toBe(false);
  expect(res.alreadyFulfilled).toBeUndefined();
});

it("records completion so a later caller can see it finished", async () => {
  await fulfillCheckout("cs_live_race");
  expect(grants).toHaveLength(1);
  expect(claims.has("fulfilled:cs_live_race")).toBe(true);
});

it("strips control characters out of a session id before logging it", async () => {
  // The session id comes from ?session_id= on the return route, so a newline in
  // it would forge a second log line. CodeQL flagged exactly this.
  //
  // Reaching that log needs the repair path: win the claim, fail the grant, then
  // fail the release. Anything less never names the session and the test would
  // pass without the fix.
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  const nasty = "cs_live_x\n[stripe] FAKE ENTRY payment approved";
  grantThrows = true;
  releaseFails = true;

  await expect(fulfillCheckout(nasty)).rejects.toThrow("grant blew up");

  const repairLog = spy.mock.calls.flat().join(" ");
  expect(repairLog).toContain("needs manual repair"); // the path really ran

  // The property that matters is that the forged text cannot become its own
  // LINE. Asserting "FAKE ENTRY" is absent would be weak — it survives as
  // "FAKEENTRY" once the space is stripped, and passes for the wrong reason.
  // What must hold is that no line break reaches the log at all.
  expect(repairLog).not.toMatch(/[\r\n]/);
  // And the mangled remains stay inside the one line the repair message owns.
  expect(repairLog.split("\n")).toHaveLength(1);
  spy.mockRestore();
});

it("keys the grant on the session, so a replay cannot grant twice", async () => {
  // The database enforces this (unique `reference`), but the key has to reach
  // it. Without the reference the migration's guard is dead weight.
  await fulfillCheckout("cs_live_race");
  expect(grantRefs).toEqual(["checkout:cs_live_race"]);
});

it("releases a claim whose holder died, so a retry can fulfill", async () => {
  // Held long ago, never completed: the holder is gone and nothing else will
  // ever release it. Before this, every retry refused forever.
  claims.set("fulfill:cs_live_race", new Date(Date.now() - 10 * 60_000).toISOString());
  const res = await fulfillCheckout("cs_live_race");

  expect(res.ok).toBe(false); // this call defers; the retry does the work
  expect(claims.has("fulfill:cs_live_race")).toBe(false);
});

it("does not release a claim that is merely slow", async () => {
  claims.set("fulfill:cs_live_race", new Date().toISOString());
  await fulfillCheckout("cs_live_race");
  expect(claims.has("fulfill:cs_live_race")).toBe(true);
});

it("does not release an old claim whose holder actually finished", async () => {
  // Age alone must not decide it: this one completed, and releasing it would
  // let a retry re-enter fulfillment for a purchase already delivered.
  claims.set("fulfill:cs_live_race", new Date(Date.now() - 10 * 60_000).toISOString());
  claims.set("fulfilled:cs_live_race", new Date().toISOString());
  const res = await fulfillCheckout("cs_live_race");

  expect(res.alreadyFulfilled).toBe(true);
  expect(claims.has("fulfill:cs_live_race")).toBe(true);
});

it("does not release a claim whose holder finishes mid-recovery", async () => {
  // The holder was still working when this caller decided the claim was stale,
  // and finished before the release ran. Deleting the claim then would let a
  // retry re-enter fulfillment for a purchase already delivered — survivable
  // now that grants are keyed, but a pointless second pass over Stripe.
  claims.set("fulfill:cs_live_race", new Date(Date.now() - 10 * 60_000).toISOString());
  completesDuringRecovery = true;

  await fulfillCheckout("cs_live_race");

  expect(claims.has("fulfill:cs_live_race")).toBe(true);
});

/**
 * The checkout base URL.
 *
 * This existed to catch one specific production failure: `headers()` is async,
 * and a hand-written `as unknown as HeaderStore` cast made it look synchronous.
 * `tsc` passed, `eslint` passed, every existing test passed, and every plan
 * purchase died with "a.get is not a function" — because `.get` was being
 * called on a Promise. The type system cannot help once a cast has lied to it,
 * so the guarantee has to be pinned by a test that actually runs the code.
 */
const get = jest.fn();
const headers = jest.fn(async () => ({ get }));
jest.mock("next/headers", () => ({ headers: () => headers() }));

const sessionsCreate = jest.fn(
  async (..._args: unknown[]) => ({ id: "cs_1", client_secret: "cs_secret", url: null }),
);
jest.mock("stripe", () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: sessionsCreate } },
  })),
);

import { createCheckout } from "./stripe";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV, STRIPE_SECRET_KEY: "sk_test_123" };
  get.mockImplementation((name: string) => (name === "origin" ? "https://www.fundexecs.com" : null));
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

it("resolves the base URL from the request rather than throwing on a Promise", async () => {
  await createCheckout({
    kind: "plan",
    orgId: "org_1",
    createdBy: "user_1",
    planKey: "pro",
    interval: "monthly",
  });

  // The bug: headers() was never awaited, so this call never happened and the
  // whole action threw before Stripe was ever reached.
  expect(get).toHaveBeenCalledWith("origin");
  expect(sessionsCreate).toHaveBeenCalled();

  const params = sessionsCreate.mock.calls[0]?.[0] as
    | { success_url?: string; cancel_url?: string }
    | undefined;
  // Whichever URLs this deployment builds, they must be absolute and rooted at
  // the request's own origin — a relative or "undefined" return_url is rejected
  // by Stripe and strands the operator mid-purchase.
  for (const url of [params?.success_url, params?.cancel_url].filter(Boolean)) {
    expect(url).toMatch(/^https:\/\/www\.fundexecs\.com/);
  }
});

it("falls back to the host header when there is no origin", async () => {
  get.mockImplementation((name: string) => (name === "host" ? "www.fundexecs.com" : null));

  await createCheckout({
    kind: "plan",
    orgId: "org_1",
    createdBy: null,
    planKey: "pro",
    interval: "monthly",
  });

  expect(get).toHaveBeenCalledWith("host");
  expect(sessionsCreate).toHaveBeenCalled();
});

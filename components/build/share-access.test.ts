jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
let ctx: { orgId: string; role: string } | null = { orgId: "org-1", role: "admin" };
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
let updated: { patch: Record<string, unknown>; filters: Record<string, unknown> } | null = null;
let matches = true;
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> = {};
      const q: Record<string, unknown> = {
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (c: string, v: unknown) => ((filters[c] = v), q),
        is: (c: string, v: unknown) => ((filters[`is:${c}`] = v), q),
        select: async () => {
          updated = { patch, filters };
          return { data: matches ? [{ id: "s1" }] : [], error: null };
        },
      };
      return q;
    },
  }),
}));

import { updateShareAccess } from "./materials-actions";

beforeEach(() => {
  ctx = { orgId: "org-1", role: "admin" };
  updated = null;
  matches = true;
  jest.useFakeTimers().setSystemTime(new Date("2026-10-02T12:00:00Z"));
});
afterEach(() => jest.useRealTimers());

it("extends the expiry from today, keeping the link's URL", async () => {
  expect(await updateShareAccess("s1", { expiresInDays: 30 })).toEqual({ ok: true });
  expect(updated!.patch).toEqual({ expires_at: "2026-11-01T12:00:00.000Z" });
  expect(updated!.filters).toEqual({ id: "s1", organization_id: "org-1", "is:revoked_at": null });
});

it("removes the expiry", async () => {
  await updateShareAccess("s1", { expiresInDays: null });
  expect(updated!.patch).toEqual({ expires_at: null });
});

it("limits domains and readers, turning the email gate on", async () => {
  expect(await updateShareAccess("s1", { allowedDomains: "@CalPERS.ca.gov, ilpa.org", maxReaders: 10 })).toEqual({ ok: true });
  expect(updated!.patch).toEqual({
    allowed_email_domains: ["calpers.ca.gov", "ilpa.org"],
    max_readers: 10,
    require_email: true,
  });
});

it("clears both limits", async () => {
  await updateShareAccess("s1", { allowedDomains: "", maxReaders: null });
  expect(updated!.patch).toEqual({ allowed_email_domains: null, max_readers: null });
});

it("refuses bad input without writing", async () => {
  expect(await updateShareAccess("s1", { allowedDomains: "calpers" })).toEqual({ ok: false, error: "Not a domain: calpers" });
  expect(await updateShareAccess("s1", { maxReaders: 0 })).toEqual({
    ok: false,
    error: "The reader limit must be a whole number above zero.",
  });
  expect(await updateShareAccess("s1", { expiresInDays: 0 })).toEqual({ ok: false, error: "Choose an expiry between 1 and 3650 days." });
  expect(updated).toBeNull();
});

it("says so when the link is revoked or gone", async () => {
  matches = false;
  expect(await updateShareAccess("s1", { expiresInDays: 7 })).toEqual({ ok: false, error: "That link is revoked or no longer exists." });
});

it("needs a signed-in member", async () => {
  ctx = null;
  expect((await updateShareAccess("s1", { expiresInDays: 7 })).ok).toBe(false);
});

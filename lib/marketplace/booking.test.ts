// Precedence for the marketplace "Book a meeting" CTA. The native FundExecs
// link sits below a firm's deliberate configuration but above any deploy-wide
// default — sending a buyer to the actual seller beats sending them to a
// platform calendar.

const from = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }),
}));
const resolveChannelCredentials = jest.fn(async () => ({}) as Record<string, string>);
jest.mock("@/lib/integrations/credentials", () => ({
  resolveChannelCredentials: (...a: unknown[]) => resolveChannelCredentials(...(a as [])),
}));
jest.mock("@/lib/site", () => ({ SITE_URL: "https://fundexecs.com" }));

type Row = Record<string, unknown>;

/** Chainable stub returning a fixed row set per table. */
function tableStub(rows: Row[]) {
  const b: Record<string, unknown> = {
    select: () => b,
    eq: () => b,
    in: () => b,
    order: () => b,
    limit: () => b,
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  return b;
}

const ORG = "org-1";

function wire(tables: Record<string, Row[]>) {
  from.mockImplementation((table: string) => tableStub(tables[table] ?? []));
}

async function freshResolve(orgId?: string | null) {
  // The module memoizes per org for 10 minutes, so each case needs a fresh
  // module registry or the previous answer leaks into it.
  let result: string | null = null;
  await jest.isolateModulesAsync(async () => {
    const mod = await import("./booking");
    result = await mod.resolveBookingUrl(orgId);
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  delete process.env.CALENDLY_API_TOKEN;
  delete process.env.CALENDLY_ACCESS_TOKEN;
  delete process.env.NEXT_PUBLIC_BOOKING_URL;
  resolveChannelCredentials.mockResolvedValue({});
});

describe("resolveBookingUrl", () => {
  it("prefers the firm's explicitly stored booking link over everything", async () => {
    process.env.NEXT_PUBLIC_BOOKING_URL = "https://calendly.com/deploy-wide";
    wire({
      organizations: [{ id: ORG, booking_url: "https://calendly.com/the-firm" }],
      scheduling_pages: [{ id: "p1", slug: "the-firm" }],
      scheduling_event_types: [{ page_id: "p1" }],
    });

    expect(await freshResolve(ORG)).toBe("https://calendly.com/the-firm");
  });

  it("falls back to the firm's native link when nothing else is configured", async () => {
    wire({
      organizations: [{ id: ORG, booking_url: null }],
      scheduling_pages: [{ id: "p1", slug: "bey-group" }],
      scheduling_event_types: [{ page_id: "p1" }],
    });

    expect(await freshResolve(ORG)).toBe("https://fundexecs.com/book/bey-group");
  });

  it("prefers the native link over a deploy-wide default", async () => {
    process.env.NEXT_PUBLIC_BOOKING_URL = "https://calendly.com/deploy-wide";
    wire({
      organizations: [{ id: ORG, booking_url: null }],
      scheduling_pages: [{ id: "p1", slug: "bey-group" }],
      scheduling_event_types: [{ page_id: "p1" }],
    });

    expect(await freshResolve(ORG)).toBe("https://fundexecs.com/book/bey-group");
  });

  it("ignores a page with no visible meeting type — a dead end is worse than no button", async () => {
    process.env.NEXT_PUBLIC_BOOKING_URL = "https://calendly.com/deploy-wide";
    wire({
      organizations: [{ id: ORG, booking_url: null }],
      scheduling_pages: [{ id: "p1", slug: "bey-group" }],
      scheduling_event_types: [], // page exists but nothing is bookable on it
    });

    expect(await freshResolve(ORG)).toBe("https://calendly.com/deploy-wide");
  });

  it("picks the earliest page when several members publish one, so the CTA is stable", async () => {
    wire({
      organizations: [{ id: ORG, booking_url: null }],
      // Ordered by created_at ascending by the query; the stub returns them in
      // that order, and only the second is actually bookable.
      scheduling_pages: [
        { id: "p1", slug: "no-types" },
        { id: "p2", slug: "has-types" },
      ],
      scheduling_event_types: [{ page_id: "p2" }],
    });

    expect(await freshResolve(ORG)).toBe("https://fundexecs.com/book/has-types");
  });

  it("returns null when a firm has no link of any kind", async () => {
    wire({
      organizations: [{ id: ORG, booking_url: null }],
      scheduling_pages: [],
      scheduling_event_types: [],
    });

    expect(await freshResolve(ORG)).toBeNull();
  });

  it("does not invent a native link for the deploy-wide CTA, which has no org", async () => {
    process.env.NEXT_PUBLIC_BOOKING_URL = "https://calendly.com/deploy-wide";
    wire({ scheduling_pages: [{ id: "p1", slug: "bey-group" }], scheduling_event_types: [{ page_id: "p1" }] });

    expect(await freshResolve()).toBe("https://calendly.com/deploy-wide");
    expect(from).not.toHaveBeenCalledWith("scheduling_pages");
  });

  it("stays quiet when the service role is unconfigured rather than throwing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    wire({});
    expect(await freshResolve(ORG)).toBeNull();
  });
});

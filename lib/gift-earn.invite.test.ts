// Coverage for the lookup behind the public /join/[code] page. It runs for
// signed-out strangers on the service role, so what it may return is the point:
// the referring firm's name and nothing else, and null — never a throw — when
// the code doesn't resolve, since the page renders a generic invitation instead
// of an error.

const selected: { table: string; columns: string }[] = [];

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: jest.fn(),
  createServerClient: jest.fn(),
}));
jest.mock("@/lib/credits", () => ({ grantCredits: jest.fn() }));

import { getReferralInvite } from "@/lib/gift-earn";
import { createServiceClient } from "@/lib/supabase/server";

// Rows keyed by table, returned by `.maybeSingle()` once every `.eq()` matches.
function makeServiceClient(rows: {
  referral_codes?: Record<string, unknown> | null;
  organizations?: Record<string, unknown> | null;
}) {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const b: Record<string, unknown> = {
        select: (columns: string) => {
          selected.push({ table, columns });
          return b;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return b;
        },
        maybeSingle: async () => ({
          data: (rows as Record<string, unknown>)[table] ?? null,
          error: null,
        }),
      };
      return b;
    },
  };
}

beforeEach(() => {
  selected.length = 0;
  jest.clearAllMocks();
});

describe("getReferralInvite", () => {
  it("resolves a code to the referring firm's name", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(
      makeServiceClient({
        referral_codes: { organization_id: "org-referrer" },
        organizations: { name: "Acme Capital" },
      }),
    );

    expect(await getReferralInvite("K7M2QX4P")).toEqual({
      code: "K7M2QX4P",
      orgName: "Acme Capital",
    });
  });

  it("reads only the firm's name off the referring org", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(
      makeServiceClient({
        referral_codes: { organization_id: "org-referrer" },
        organizations: { name: "Acme Capital" },
      }),
    );

    await getReferralInvite("K7M2QX4P");

    const orgSelect = selected.find((s) => s.table === "organizations");
    expect(orgSelect?.columns).toBe("name");
  });

  it("accepts a code however it was retyped", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(
      makeServiceClient({
        referral_codes: { organization_id: "org-referrer" },
        organizations: { name: "Acme Capital" },
      }),
    );

    expect(await getReferralInvite("  k7m2qx4p  ")).toEqual({
      code: "K7M2QX4P",
      orgName: "Acme Capital",
    });
  });

  it("returns null for an unknown code", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(
      makeServiceClient({ referral_codes: null }),
    );

    expect(await getReferralInvite("NOSUCHCODE")).toBeNull();
  });

  it("returns null when the code resolves to an org with no name", async () => {
    (createServiceClient as jest.Mock).mockReturnValue(
      makeServiceClient({
        referral_codes: { organization_id: "org-referrer" },
        organizations: null,
      }),
    );

    expect(await getReferralInvite("K7M2QX4P")).toBeNull();
  });

  it("returns null for an empty code without touching the database", async () => {
    const client = makeServiceClient({});
    (createServiceClient as jest.Mock).mockReturnValue(client);

    expect(await getReferralInvite("   ")).toBeNull();
    expect(createServiceClient as jest.Mock).not.toHaveBeenCalled();
  });

  it("degrades to null rather than throwing the invite page away", async () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    (createServiceClient as jest.Mock).mockImplementation(() => {
      throw new Error("service role not configured");
    });

    expect(await getReferralInvite("K7M2QX4P")).toBeNull();
    err.mockRestore();
  });
});

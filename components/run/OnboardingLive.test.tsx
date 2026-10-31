let ctx: { orgId: string } | null = { orgId: "org-1" };
let sessions: unknown[] = [];
let sessionsError = false;

jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: async () => {
          if (sessionsError) throw new Error("db down");
          return { data: table === "lp_onboarding_sessions" ? sessions : [] };
        },
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: table === "funds" ? [{ id: "f1", name: "Fund II" }] : [] }),
      };
      return q;
    },
  }),
}));

import { render, screen } from "@testing-library/react";
import { OnboardingLive } from "./OnboardingLive";

beforeEach(() => {
  ctx = { orgId: "org-1" };
  sessions = [];
  sessionsError = false;
});

const row = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  lp_name: "Calpers Pension",
  lp_email: "ops@calpers.ca.gov",
  status: "accreditation",
  fund_id: "f1",
  commitment_amount: 5_000_000,
  expires_at: "2099-01-01T00:00:00Z",
  token: "tok",
  ...over,
});

describe("Run › Onboarding", () => {
  it("shows where to invite an LP when none are being onboarded", async () => {
    render(await OnboardingLive());
    expect(screen.getByText("No LPs are being onboarded yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Source › Allocators/ })).toHaveAttribute("href", "/source/allocators");
  });

  it("lists each LP with where it stands", async () => {
    sessions = [row(), row({ id: "s2", lp_name: "Ilpa Fund", status: "complete", token: "tok2" })];
    render(await OnboardingLive());
    expect(screen.getByText("Calpers Pension")).toBeInTheDocument();
    expect(screen.getByText("Ilpa Fund")).toBeInTheDocument();
    expect(screen.queryByText("No LPs are being onboarded yet.")).toBeNull();
  });

  it("shows the empty state, not an error, when signed in without an organization", async () => {
    ctx = null;
    render(await OnboardingLive());
    expect(screen.getByText("No LPs are being onboarded yet.")).toBeInTheDocument();
  });

  it("degrades to the empty state when the read fails", async () => {
    sessionsError = true;
    render(await OnboardingLive());
    expect(screen.getByText("No LPs are being onboarded yet.")).toBeInTheDocument();
  });
});

let ctx: { orgId: string | null; role: string | null } | null = { orgId: "org-1", role: "admin" };
let failReads = false;
let reads: string[] = [];
const tables: Record<string, unknown[]> = {};

jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ctx }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      reads.push(table);
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          if (failReads) return reject(new Error("db down"));
          resolve({ data: tables[table] ?? [] });
        },
      };
      return q;
    },
  }),
}));
// The review cards are exercised in OnboardingReview.test.tsx.
jest.mock("@/components/run/OnboardingReview", () => ({
  OnboardingReview: ({ lps }: { lps: Array<{ lpName: string; stageLabel: string; checks: unknown[]; decisions: unknown[]; activity: Array<{ text: string }> }> }) => (
    <ul>
      {lps.map((l) => (
        <li key={l.lpName}>
          {l.lpName} | {l.stageLabel} | checks:{l.checks.length} | decisions:{l.decisions.length} | {l.activity.map((a) => a.text).join(";")}
        </li>
      ))}
    </ul>
  ),
}));

import { render, screen } from "@testing-library/react";
import { OnboardingLive } from "./OnboardingLive";

beforeEach(() => {
  ctx = { orgId: "org-1", role: "admin" };
  failReads = false;
  reads = [];
  for (const k of Object.keys(tables)) delete tables[k];
});

const session = (over: Record<string, unknown> = {}) => ({ id: "s1", lp_name: "Calpers Pension", lp_email: "ops@calpers.ca.gov", status: "accreditation", ...over });

describe("Run › Onboarding", () => {
  it("shows where to invite an LP when none are being onboarded", async () => {
    render(await OnboardingLive());
    expect(screen.getByText("No LPs are being onboarded yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Source › Allocators/ })).toHaveAttribute("href", "/source/allocators");
  });

  it("hands each LP its stage, checks, decisions and activity", async () => {
    tables.lp_onboarding_sessions = [session(), session({ id: "s2", lp_name: "Ilpa Fund", status: "complete" })];
    tables.onboarding_checks = [{ session_id: "s1", kind: "identity", status: "clear", summary: null, checked_at: null, expires_at: null }];
    tables.onboarding_decisions = [{ id: "d1", session_id: "s1", decision: "approved", reason: "ok", decided_at: "2026-10-31T00:00:00Z" }];
    tables.onboarding_audit_log = [
      { id: 1, session_id: "s1", action: "check.recorded", detail: { kind: "identity", status: "clear" }, created_at: "2026-10-31T00:00:00Z" },
      { id: 2, session_id: "s2", action: "decision.recorded", detail: { decision: "rejected" }, created_at: "2026-10-31T00:00:00Z" },
    ];
    render(await OnboardingLive());
    expect(screen.getByText(/Calpers Pension \| Accreditation \| checks:1 \| decisions:1 \| Identity check recorded as clear/)).toBeInTheDocument();
    expect(screen.getByText(/Ilpa Fund \| Complete \| checks:0 \| decisions:0 \| Decision recorded: rejected/)).toBeInTheDocument();
  });

  it("is for owners and admins: a member sees a notice and nothing is read", async () => {
    ctx = { orgId: "org-1", role: "member" };
    tables.lp_onboarding_sessions = [session()];
    render(await OnboardingLive());
    expect(screen.getByText("LP onboarding records are visible to organization owners and admins.")).toBeInTheDocument();
    expect(screen.queryByText(/Calpers Pension/)).toBeNull();
    expect(reads).toEqual([]);
  });

  it("lets an owner in", async () => {
    ctx = { orgId: "org-1", role: "owner" };
    tables.lp_onboarding_sessions = [session()];
    render(await OnboardingLive());
    expect(screen.getByText(/Calpers Pension/)).toBeInTheDocument();
  });

  it("asks someone with no organization to join one, without reading anything", async () => {
    ctx = { orgId: null, role: null };
    render(await OnboardingLive());
    expect(screen.getByText("Join or create an organization to onboard LPs.")).toBeInTheDocument();
    expect(reads).toEqual([]);
  });

  it("degrades to the empty state when a read fails", async () => {
    failReads = true;
    render(await OnboardingLive());
    expect(screen.getByText("No LPs are being onboarded yet.")).toBeInTheDocument();
  });
});

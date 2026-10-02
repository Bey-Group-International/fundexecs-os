jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth", () => ({ getSessionContext: async () => ({ orgId: "org-1", role: "admin" }) }));
let followUps: { viewer_key: string; sent_at: string }[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: followUps }).then(resolve),
      };
      return q;
    },
  }),
}));
jest.mock("./engagement-actions", () => ({ refreshEngagementReads: jest.fn() }));
jest.mock("./follow-up-actions", () => ({ draftInvestorFollowUp: jest.fn(), sendInvestorFollowUp: jest.fn() }));
let crm = new Map();
jest.mock("@/lib/data-room-crm.server", () => ({ crmMatches: async () => crm }));

import { render, screen, within } from "@testing-library/react";
import { buildEngagement, type EngagementView } from "@/lib/data-room-engagement";

let views: EngagementView[] = [];
let reads = new Map();
jest.mock("@/lib/data-room-engagement.server", () => ({
  loadRoomEngagement: async () => ({
    engagement: buildEngagement(views, new Map([["ppm", "PPM v3"], ["deck", "Pitch deck"]]), new Map([["l1", "Fund II LPs"]])),
    reads,
  }),
}));

import { ViewerAnalytics } from "./ViewerAnalytics";

const row = (o: Partial<EngagementView>): EngagementView => ({
  share_id: "l1",
  document_id: null,
  kind: "document",
  action: "read",
  viewer_email: null,
  session_id: null,
  duration_seconds: null,
  created_at: new Date().toISOString(),
  ...o,
});

async function show() {
  render((await ViewerAnalytics({ roomId: "room-1" }))!);
}

beforeEach(() => {
  views = [];
  reads = new Map();
  followUps = [];
  crm = new Map();
});

it("says so when nobody has opened the room", async () => {
  await show();
  expect(screen.getByText("No investor activity yet.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Ask Earn/ })).toBeNull();
});

it("lists each investor with their time, documents and timeline, and the most-read documents", async () => {
  views = [
    row({ document_id: "ppm", viewer_email: "lp@x.com", session_id: "b1", duration_seconds: 900 }),
    row({ document_id: "ppm", action: "download", viewer_email: "lp@x.com" }),
    row({ document_id: "deck", session_id: "b2", duration_seconds: 45 }),
  ];
  await show();

  const lp = screen.getByText("lp@x.com").closest("details")!;
  expect(within(lp).getByText(/15 min · 1 doc · 1 download/)).toBeInTheDocument();
  expect(within(lp).getByText("Hot")).toBeInTheDocument();
  expect(within(lp).getByText(/via Fund II LPs/)).toBeInTheDocument();
  expect(within(lp).getByText(/read 15 min · downloaded/)).toBeInTheDocument();

  expect(screen.getByText("Visitor b2")).toBeInTheDocument();
  expect(screen.getByText("Most-read documents")).toBeInTheDocument();
  expect(screen.getByText(/15 min · 1 reader · 1 ↓/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Ask Earn to read interest" })).toBeInTheDocument();
});

it("shows Earn's read and flags activity newer than it", async () => {
  views = [row({ document_id: "ppm", viewer_email: "lp@x.com", duration_seconds: 300, created_at: "2026-10-02T10:00:00Z" })];
  reads = new Map([
    [
      "email:lp@x.com",
      {
        viewer_key: "email:lp@x.com",
        signal: "warm",
        summary: "Focused on the PPM's fee terms.",
        follow_up: "Send the fee comparison.",
        activity_through: "2026-10-02T09:00:00Z",
      },
    ],
  ]);
  await show();
  expect(screen.getByText(/Focused on the PPM's fee terms\./)).toBeInTheDocument();
  expect(screen.getByText("Next: Send the fee comparison.")).toBeInTheDocument();
  expect(screen.getByText("(new activity since Earn's read)")).toBeInTheDocument();
  expect(screen.getByText("Warm")).toBeInTheDocument(); // Earn's signal wins over the rules'
  expect(screen.getByRole("button", { name: "Refresh Earn's read" })).toBeInTheDocument();
});

it("links a reader to their CRM record, offers a follow-up, and shows when they were last followed up", async () => {
  views = [row({ document_id: "ppm", viewer_email: "lp@x.com", duration_seconds: 900 })];
  crm = new Map([["lp@x.com", { contactId: "c1", contactName: "Jane Doe", investorId: null, investorName: null }]]);
  followUps = [{ viewer_key: "email:lp@x.com", sent_at: "2026-10-01T10:00:00Z" }];
  await show();
  expect(screen.getByRole("link", { name: "Jane Doe →" }).getAttribute("href")).toBe("/network/c1");
  expect(screen.getByText("Followed up Oct 1")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Draft follow-up" })).toBeInTheDocument();
});

it("says when a named reader isn't in the CRM, and offers no follow-up to unnamed ones", async () => {
  views = [
    row({ document_id: "ppm", viewer_email: "new@x.com", duration_seconds: 60 }),
    row({ document_id: "deck", session_id: "b9", duration_seconds: 60 }),
  ];
  await show();
  expect(screen.getByText("Not in your CRM yet")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Draft follow-up" })).toHaveLength(1);
});

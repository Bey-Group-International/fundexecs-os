/**
 * The inbox page's one job in this feature: carrying the draft from the read to
 * the card.
 *
 * It is a single expression — `draft ? { body, origin } : null` — and neither the
 * loader's tests nor the composer's tests can see it. Break it and everything else
 * still passes: getInboxThreads still finds the draft, the composer still renders
 * one when it is given one, and no draft ever reaches a person. Which is the same
 * gap that let a correction UI ship with its read-path flag inverted while 7,888
 * tests passed.
 *
 * There was no test for this page at all before this file.
 *
 * The board itself is rendered as a marker. What is NOT covered here, said rather
 * than implied: the "Draft ready to send" pill on the collapsed card, which lives
 * inside InboxBoard — a client component that lazily imports the conversation panel
 * through next/dynamic, and mounting it here would be a test of that machinery
 * rather than of this seam.
 */
import React from "react";
import { render, screen } from "@testing-library/react";

const getInboxThreads = jest.fn();
const getInbox = jest.fn();
const getOrgTeammates = jest.fn();
const orgConnectedChannels = jest.fn();
const getSessionContext = jest.fn();

jest.mock("@/lib/auth", () => ({ getSessionContext: () => getSessionContext() }));
jest.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirected"); } }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        neq: () => chain,
        limit: async () => ({ data: [] }),
      };
      return chain;
    },
  }),
}));
jest.mock("@/lib/inbox", () => ({ getInbox: (...a: unknown[]) => getInbox(...a) }));
jest.mock("@/components/inbox/InboxView", () => ({ InboxView: () => null }));
jest.mock("@/lib/inbox/data", () => {
  const actual = jest.requireActual("@/lib/inbox/data");
  return {
    ...actual,
    getInboxThreads: (...a: unknown[]) => getInboxThreads(...a),
    autoUnsnoozeExpired: async () => {},
  };
});
jest.mock("@/lib/integrations/gateway", () => ({
  orgConnectedChannels: (...a: unknown[]) => orgConnectedChannels(...a),
}));
jest.mock("./actions", () => ({
  markOpenThreadsRead: async () => {},
  getOrgTeammates: (...a: unknown[]) => getOrgTeammates(...a),
}));
jest.mock("./InboxReadMarker", () => ({ InboxReadMarker: () => null }));
jest.mock("./InboxLive", () => ({ InboxLive: () => null }));
jest.mock("./InboxSearch", () => ({ InboxSearch: () => null }));

// A marker reporting what the page handed the board for each card, so the prop is
// read rather than inferred from whatever happens to render.
jest.mock("./InboxBoard", () => ({
  InboxBoard: ({ cards }: { cards: Array<{ id: string; draft: unknown }> }) => (
    <div data-testid="board" data-order={cards.map((c) => c.id).join(",")}>
      {cards.map((c) => (
        <div key={c.id} data-testid={`card-${c.id}`} data-draft={JSON.stringify(c.draft)} />
      ))}
    </div>
  ),
}));

import InboxPage from "./page";

function thread(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    organization_id: "org-1",
    channel: "gmail",
    category: "messaging",
    subject: "Pacing",
    counterparty_name: "Ana Diaz",
    counterparty_email: "ana@acme.com",
    preview: "Hi — following up",
    status: "open",
    unread: false,
    priority: 40,
    intent: null,
    ai_summary: null,
    last_message_at: "2026-09-01T00:00:00.000Z",
    meeting_at: null,
    meeting_url: null,
    deal_id: null,
    investor_id: null,
    created_by: null,
    assigned_to: null,
    snoozed_until: null,
    external_id: null,
    starred: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

const DRAFT = {
  threadId: "t1",
  body: "Hi Ana,\n\nThanks for the time today.",
  source: "meeting_follow_up",
  sourceMeetingId: "m1",
  updatedAt: "2026-09-30T12:00:00.000Z",
};

async function renderPage() {
  const ui = await InboxPage({ searchParams: Promise.resolve({}) });
  return render(ui as React.ReactElement);
}

beforeEach(() => {
  jest.clearAllMocks();
  getSessionContext.mockResolvedValue({ orgId: "org-1", userId: "p1", role: "owner" });
  getInbox.mockResolvedValue({ tasks: [], approvals: [], risks: [], deals: [] });
  getOrgTeammates.mockResolvedValue([]);
  orgConnectedChannels.mockResolvedValue(new Set(["gmail"]));
});

describe("the draft on its way to the card", () => {
  it("carries the body and a line saying it has not been sent", async () => {
    getInboxThreads.mockResolvedValue([
      { thread: thread(), context: null, assignee: null, draft: DRAFT },
    ]);
    await renderPage();

    const card = JSON.parse(screen.getByTestId("card-t1").getAttribute("data-draft")!);
    expect(card.body).toBe(DRAFT.body);
    // Resolved on the server so the client board never imports the module that
    // computes it — and the sentence the composer must show.
    expect(card.origin).toMatch(/Nothing has been sent/);
  });

  it("is null for a thread with nothing waiting", async () => {
    getInboxThreads.mockResolvedValue([
      { thread: thread(), context: null, assignee: null, draft: null },
    ]);
    await renderPage();
    expect(screen.getByTestId("card-t1").getAttribute("data-draft")).toBe("null");
  });

  // The loader already puts draft-carrying threads first. The page must not
  // re-sort them back — it maps, and mapping is order-preserving, which is the
  // property being fixed here rather than assumed.
  it("keeps the order the loader decided", async () => {
    getInboxThreads.mockResolvedValue([
      { thread: thread({ id: "with-draft", priority: 0 }), context: null, assignee: null, draft: { ...DRAFT, threadId: "with-draft" } },
      { thread: thread({ id: "hot", priority: 90 }), context: null, assignee: null, draft: null },
    ]);
    await renderPage();
    expect(screen.getByTestId("board")).toHaveAttribute("data-order", "with-draft,hot");
  });
});

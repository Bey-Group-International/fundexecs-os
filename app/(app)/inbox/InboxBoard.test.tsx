/**
 * The inbox list and its reading pane, Gmail-style: one row per thread, a click
 * opens the thread on the right, ↑/↓ move between threads, Esc closes, and
 * opening an unread thread reads it.
 */
import { act, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = jest.fn();
const bulkThreadAction = jest.fn();
const setThreadStatus = jest.fn();

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => refresh() }) }));
jest.mock("next/dynamic", () => () =>
  function ThreadConversationStub({ card }: { card: { id: string } }) {
    return <div data-testid="conversation">conversation:{card.id}</div>;
  },
);
jest.mock("./actions", () => ({
  actOnThread: jest.fn(),
  shareCommandCenter: jest.fn(),
  setThreadStatus: (...a: unknown[]) => setThreadStatus(...a),
  deleteThreadAction: jest.fn(),
  clearInbox: jest.fn(),
  assignThread: jest.fn(),
  setThreadStar: jest.fn(async () => ({ ok: true })),
  bulkThreadAction: (...a: unknown[]) => bulkThreadAction(...a),
  snoozeThread: jest.fn(),
}));

import { InboxBoard, type InboxCardData } from "./InboxBoard";

function card(id: string, over: Partial<InboxCardData> = {}): InboxCardData {
  return {
    id,
    channel: "gmail",
    channelLabel: "Gmail",
    channelIcon: "✉",
    category: "messaging",
    subject: `Subject ${id}`,
    counterparty: `Sender ${id}`,
    summary: `Earn summary for ${id}`,
    snippet: `Latest message in ${id}`,
    lastMessageAt: "2026-01-05T15:00:00.000Z",
    intent: null,
    priority: 50,
    bucket: "now",
    tab: "focused",
    unread: false,
    starred: false,
    status: "open",
    snoozedUntil: null,
    meetingAt: null,
    meetingUrl: null,
    context: { kind: "deal", id: "d1", name: "Acme", href: "/deals/d1" },
    assignee: null,
    meeting: null,
    connected: true,
    suggested: null,
    quickReplies: [],
    nudge: null,
    canShare: false,
    shareTier: 2,
    draft: null,
    ...over,
  };
}

const CARDS = [card("a", { unread: true }), card("b"), card("c")];

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, "", "/inbox");
  bulkThreadAction.mockResolvedValue({ ok: true, count: 1 });
  setThreadStatus.mockResolvedValue({ ok: true });
});

function board(cards = CARDS) {
  return render(<InboxBoard cards={cards} teammates={[]} />);
}

const openButton = (id: string) => screen.getByRole("button", { name: new RegExp(`Open thread: Subject ${id}\\b`) });

describe("rows", () => {
  it("show sender, subject, snippet and time on one row — not the summary or deal links", () => {
    board();
    const row = openButton("b");
    expect(within(row).getByText("Sender b")).toBeInTheDocument();
    expect(within(row).getByText("Subject b")).toBeInTheDocument();
    expect(within(row).getByText(/Latest message in b/)).toBeInTheDocument();
    expect(within(row).getByText(/Jan 5/)).toBeInTheDocument();
    expect(screen.queryByText("Earn summary for b")).not.toBeInTheDocument();
    expect(screen.queryByText(/Deal: Acme/)).not.toBeInTheDocument();
  });

  it("bold an unread thread's sender", () => {
    board();
    expect(within(openButton("a")).getByText("Sender a")).toHaveClass("font-semibold");
    expect(within(openButton("b")).getByText("Sender b")).not.toHaveClass("font-semibold");
  });

  it("flag a waiting draft", () => {
    board([card("a", { draft: { body: "x", origin: "y", revision: "z" } })]);
    expect(within(openButton("a")).getByText("Draft")).toBeInTheDocument();
  });
});

describe("the reading pane", () => {
  it("opens the thread on a click, with its summary, links and conversation", async () => {
    const user = userEvent.setup();
    board();
    await user.click(openButton("b"));
    const pane = screen.getByRole("article", { name: "Thread: Subject b" });
    expect(within(pane).getByText("Earn summary for b")).toBeInTheDocument();
    expect(within(pane).getByText(/Deal: Acme/)).toBeInTheDocument();
    expect(within(pane).getByTestId("conversation")).toHaveTextContent("conversation:b");
    expect(window.location.search).toBe("?t=b");
  });

  it("reads an unread thread when it opens, and un-bolds its row", async () => {
    const user = userEvent.setup();
    board();
    await user.click(openButton("a"));
    await waitFor(() => expect(bulkThreadAction).toHaveBeenCalledWith(["a"], "read"));
    expect(within(openButton("a")).getByText("Sender a")).not.toHaveClass("font-semibold");
  });

  it("does not mark an already-read thread again", async () => {
    const user = userEvent.setup();
    board();
    await user.click(openButton("b"));
    expect(bulkThreadAction).not.toHaveBeenCalled();
  });

  it("moves with the arrow keys and j/k, and Esc closes", async () => {
    const user = userEvent.setup();
    board();
    await user.click(openButton("a"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("article", { name: "Thread: Subject b" })).toBeInTheDocument();
    await user.keyboard("j");
    expect(screen.getByRole("article", { name: "Thread: Subject c" })).toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("article", { name: "Thread: Subject c" })).toBeInTheDocument();
    await user.keyboard("k");
    expect(screen.getByRole("article", { name: "Thread: Subject b" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  it("leaves the keys alone while the operator is typing", async () => {
    board();
    fireEvent.click(openButton("a"));
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "j" });
    expect(screen.getByRole("article", { name: "Thread: Subject a" })).toBeInTheDocument();
    input.remove();
  });

  it("restores the open thread from the link", async () => {
    window.history.replaceState(null, "", "/inbox?t=c");
    board();
    expect(await screen.findByRole("article", { name: "Thread: Subject c" })).toBeInTheDocument();
  });

  it("moves on to the next thread after Done", async () => {
    const user = userEvent.setup();
    board();
    await user.click(openButton("a"));
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.getByRole("article", { name: "Thread: Subject b" })).toBeInTheDocument());
    expect(setThreadStatus).toHaveBeenCalled();
  });

  it("steps with the pane's own previous/next buttons", async () => {
    const user = userEvent.setup();
    board();
    await user.click(openButton("a"));
    expect(screen.getByRole("button", { name: "Previous thread" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next thread" }));
    expect(screen.getByRole("article", { name: "Thread: Subject b" })).toBeInTheDocument();
  });

  it("closes from the pane", async () => {
    const user = userEvent.setup();
    board();
    await user.click(openButton("a"));
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "Close thread" }));
    });
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });
});

/**
 * What the copilot sidebar costs while somebody is talking.
 *
 * The room re-renders several times a second for the length of every call, and
 * not because anything on screen changed: the voice meter samples every 120ms
 * (VOICE_SAMPLE_MS) and the `speaking` set turns over whenever a voice crosses
 * the 900ms hold (SPEAKING_HOLD_MS) — which is every pause in ordinary
 * conversation. Each of those re-rendered this whole panel.
 *
 * So these tests are measurements, not assertions about markup. The number they
 * pin is `chatParts`, the regex scan that turns one message's text into linked
 * and unlinked runs: real per-message work, done on every render, to produce
 * nodes identical to the ones already on screen. Before the memo a fifty-message
 * chat re-ran it fifty times per speaking change. It is now zero.
 *
 * The second half is the hazard the fix introduces. Memoized rows need stable
 * handlers, stable handlers are a closure made once, and a closure made once is
 * how a button ends up calling a callback from three minutes ago. There are
 * tests for that below, and they are the ones worth keeping.
 */

// Spying on the real thing rather than a stub: the count only means something
// if it is the work the panel actually does.
jest.mock("@/lib/meetings/chat", () => {
  const actual = jest.requireActual("@/lib/meetings/chat");
  return {
    ...actual,
    chatParts: jest.fn(actual.chatParts),
    // Counted as well as chatParts, and for a reason worth stating: two memos
    // guard this path — one on the message text, one on the turn around it —
    // and each alone is enough to hold chatParts at zero. A count of chatParts
    // therefore says nothing about the turn memo. chatClock is called once per
    // TURN, so it measures the half chatParts cannot see.
    chatClock: jest.fn(actual.chatClock),
  };
});

jest.mock("@/lib/meetings/hands", () => {
  const actual = jest.requireActual("@/lib/meetings/hands");
  return { ...actual, handsFirst: jest.fn(actual.handsFirst) };
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopilotSidebar } from "./CallParts";
import { chatClock, chatParts, type ChatMessage } from "@/lib/meetings/chat";
import { handsFirst } from "@/lib/meetings/hands";

const parts = chatParts as jest.Mock;
const clock = chatClock as jest.Mock;
const ordering = handsFirst as jest.Mock;

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1", from: "p2", displayName: "Rae", text: "shall we start?", ts: 1_000, ...over,
});

/** A chat with enough in it to be worth not rebuilding. */
const CHAT: ChatMessage[] = Array.from({ length: 50 }, (_, i) =>
  message({
    id: `m${i}`,
    from: i % 2 ? "p2" : "p3",
    displayName: i % 2 ? "Rae" : "Tom",
    // A link in every message, because that is what makes chatParts do work.
    text: `Point ${i}, see https://example.com/fund-iv/q3-${i}.pdf`,
    ts: 1_000 + i * 60_000,
  }),
);

/**
 * Held as constants, because these stand in for React state.
 *
 * A fresh `new Set()` per render is not what the room does — `raisedHands` is
 * state, and keeps its identity until a hand actually moves. Building a new one
 * in the fixture made the ordering memo look broken when it was the test that
 * was changing the input on every render.
 */
const NO_HANDS: ReadonlySet<string> = new Set<string>();
const NOBODY_SPEAKING: ReadonlySet<string> = new Set<string>();

const PEOPLE = [
  { id: "p1", displayName: "Alina", micOn: true, isLocal: true },
  { id: "p2", displayName: "Rae", micOn: true, isLocal: false },
  { id: "p3", displayName: "Tom", micOn: false, isLocal: false },
];

function props(over: Partial<React.ComponentProps<typeof CopilotSidebar>> = {}) {
  return {
    srStatus: "active" as const,
    participants: PEOPLE,
    speaking: NOBODY_SPEAKING as Set<string>,
    roomCode: "abc-defg-hij",
    meetingTitle: "Fund IV sync",
    chatMessages: CHAT,
    chatUnread: 0,
    onSendChat: jest.fn(),
    onRetryChat: jest.fn(),
    isHost: true,
    raisedHands: NO_HANDS as Set<string>,
    onKick: jest.fn(),
    onAdmit: jest.fn(),
    onDeny: jest.fn(),
    onAdmitAll: jest.fn(),
    waitingPeers: [],
    removedPeople: [],
    onAllowBack: jest.fn(),
    onChatVisibility: jest.fn(),
    onCollapse: jest.fn(),
    ...over,
  };
}

beforeEach(() => {
  parts.mockClear();
  clock.mockClear();
  ordering.mockClear();
});

describe("what a speaking change costs", () => {
  it("does not re-read every message each time somebody starts or stops talking", () => {
    // THE measurement. Six changes is about a second and a half of conversation;
    // a call is an hour of it.
    const { rerender } = render(<CopilotSidebar {...props()} />);
    const afterMount = parts.mock.calls.length;
    expect(afterMount).toBe(CHAT.length);

    const turnsAfterMount = clock.mock.calls.length;
    for (let i = 0; i < 6; i++) {
      rerender(<CopilotSidebar {...props({ speaking: new Set([i % 2 ? "p2" : "p3"]) })} />);
    }

    expect(parts.mock.calls.length).toBe(afterMount);
    // And the turns around them were not rebuilt either.
    expect(clock.mock.calls.length).toBe(turnsAfterMount);
  });

  it("re-reads nothing when the room re-renders for any other reason", () => {
    // The panel's props change constantly — unread counts, hands, the waiting
    // queue. None of them are the chat.
    const { rerender } = render(<CopilotSidebar {...props()} />);
    const afterMount = parts.mock.calls.length;

    rerender(<CopilotSidebar {...props({ chatUnread: 3 })} />);
    rerender(<CopilotSidebar {...props({ raisedHands: new Set(["p2"]) })} />);
    rerender(<CopilotSidebar {...props({ srStatus: "error" })} />);

    expect(parts.mock.calls.length).toBe(afterMount);
  });

  it("does not re-sort the people list either", async () => {
    // The list is ordered hands-first, which is a sort over everyone in the
    // call. It depends on who is here and whose hand is up — neither of which a
    // pause in speech changes.
    //
    // NOTE what this does and does not cover: the panel is rendered here with a
    // participants array that keeps its identity, which is what makes the memo
    // hold. Whether the ROOM hands it a stable one is a property of MeetingRoom,
    // and MeetingRoom cannot be rendered in a test — reaching it means opening a
    // camera, an ICE negotiation and a Realtime channel.
    const { rerender } = render(<CopilotSidebar {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /People/ }));
    const afterOpen = ordering.mock.calls.length;
    expect(afterOpen).toBeGreaterThan(0);

    for (let i = 0; i < 6; i++) {
      rerender(<CopilotSidebar {...props({ speaking: new Set([i % 2 ? "p2" : "p3"]) })} />);
    }

    expect(ordering.mock.calls.length).toBe(afterOpen);
  });

  it("does rebuild the order when a hand goes up", async () => {
    const { rerender } = render(<CopilotSidebar {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /People/ }));
    const afterOpen = ordering.mock.calls.length;

    rerender(<CopilotSidebar {...props({ raisedHands: new Set(["p3"]) })} />);

    expect(ordering.mock.calls.length).toBeGreaterThan(afterOpen);
  });

  it("does not rebuild the turns either — the rows, not just the text", () => {
    // Guards the turn memo on its own. Without this, removing it passes: the
    // memo on the message text alone keeps chatParts at zero while every turn
    // around it is rebuilt.
    const { rerender } = render(<CopilotSidebar {...props()} />);
    const afterMount = clock.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    for (let i = 0; i < 6; i++) {
      rerender(<CopilotSidebar {...props({ speaking: new Set([i % 2 ? "p2" : "p3"]) })} />);
    }

    expect(clock.mock.calls.length).toBe(afterMount);
  });

  it("still reads a message that is actually new", () => {
    // The other direction, and the one that would make the memo a bug rather
    // than an optimization: a chat that stops updating is worse than a slow one.
    const { rerender } = render(<CopilotSidebar {...props()} />);
    const afterMount = parts.mock.calls.length;

    const said = message({ id: "new", from: "p2", displayName: "Rae", text: "and the memo lands Friday", ts: 9_000_000 });
    rerender(<CopilotSidebar {...props({ chatMessages: [...CHAT, said] })} />);

    expect(parts.mock.calls.length).toBeGreaterThan(afterMount);
    expect(screen.getByText(/the memo lands Friday/)).toBeInTheDocument();
  });
});

describe("the handlers the memoized rows hold", () => {
  it("retries through the callback the room has NOW, not the one it mounted with", async () => {
    // The hazard the fix introduces. A stable handler is a closure created once;
    // made the obvious way it captures the first render's props and keeps
    // calling them, so Retry would reach a socket that has since been replaced.
    const first = jest.fn();
    const latest = jest.fn();
    const failed = [message({ id: "f1", text: "did not send", delivery: "failed" })];

    const { rerender } = render(<CopilotSidebar {...props({ chatMessages: failed, onRetryChat: first })} />);
    rerender(<CopilotSidebar {...props({ chatMessages: failed, onRetryChat: latest })} />);

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(latest).toHaveBeenCalledWith("f1");
    expect(first).not.toHaveBeenCalled();
  });

  it("removes through the current callback too", async () => {
    const first = jest.fn();
    const latest = jest.fn();

    const { rerender } = render(<CopilotSidebar {...props({ onKick: first })} />);
    await userEvent.click(screen.getByRole("button", { name: /People/ }));
    rerender(<CopilotSidebar {...props({ onKick: latest })} />);

    // Scoped to Rae's row: the host can remove everybody who is not themselves,
    // so "Remove" is ambiguous across the list.
    const rae = screen.getByText("Rae").closest("div")!;
    await userEvent.click(within(rae).getByRole("button", { name: "Remove" }));

    expect(latest).toHaveBeenCalledWith("p2");
    expect(first).not.toHaveBeenCalled();
  });
});

describe("the panel still says what it said", () => {
  it("shows the messages, with their links clickable", () => {
    render(<CopilotSidebar {...props()} />);
    expect(screen.getByText("Point 0, see")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "https://example.com/fund-iv/q3-0.pdf" });
    expect(link).toHaveAttribute("href", "https://example.com/fund-iv/q3-0.pdf");
    // Other people's text, so the link is opened without handing the opener over.
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("lights the dot on the person who is speaking, and only them", async () => {
    render(<CopilotSidebar {...props({ speaking: new Set(["p2"]) })} />);
    await userEvent.click(screen.getByRole("button", { name: /People/ }));

    expect(screen.getByTitle("Speaking now")).toBeInTheDocument();
    expect(screen.getAllByTitle("Speaking now")).toHaveLength(1);
    expect(screen.getByText("◉ speaking")).toBeInTheDocument();
  });

  it("says muted rather than quiet, which are not the same fact", async () => {
    // Tom's mic is off: nothing he says reaches the transcript, and that is
    // worth stating rather than leaving to inference.
    render(<CopilotSidebar {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: /People/ }));
    expect(screen.getByTitle("Muted — not being transcribed")).toBeInTheDocument();
  });

  it("puts a raised hand at the top of the list", async () => {
    render(<CopilotSidebar {...props({ raisedHands: new Set(["p3"]) })} />);
    await userEvent.click(screen.getByRole("button", { name: /People/ }));

    const names = screen.getAllByText(/^(Alina|Rae|Tom)$/).map((n) => n.textContent);
    expect(names[0]).toBe("Tom");
    expect(screen.getByText("✋")).toBeInTheDocument();
  });
});

describe("the data-room tab", () => {
  it("is absent for a guest, who has no firm to share from", () => {
    render(<CopilotSidebar {...props({ canShareDocs: false })} />);
    expect(screen.queryByRole("button", { name: /^Docs$/ })).not.toBeInTheDocument();
  });

  it("is offered to anyone signed in", () => {
    render(<CopilotSidebar {...props({ canShareDocs: true, meetingId: "m1" })} />);
    expect(screen.getByRole("button", { name: /^Docs$/ })).toBeInTheDocument();
  });

  it("does not touch the data room until the tab is opened", async () => {
    // A call where nobody shares a document must not read the firm's materials.
    // The panel is mounted by the tab, not by the sidebar.
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ docs: [], shared: [] }) }) as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<CopilotSidebar {...props({ canShareDocs: true, meetingId: "m1" })} />);
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /^Docs$/ }));
    expect(fetchMock).toHaveBeenCalledWith("/api/meetings/m1/documents", { cache: "no-store" });
  });
});

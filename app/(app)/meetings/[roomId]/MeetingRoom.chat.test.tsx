/**
 * The in-call chat panel.
 *
 * Rendered directly rather than through MeetingRoom, for the reason
 * MeetingRoom.exit.test.tsx gives: reaching this panel means entering a room,
 * which opens a camera, an ICE negotiation and a Realtime channel, and a test
 * that mocked all of that would be testing its own mocks.
 *
 * What these pin is the half of each defect that lives in the panel. The
 * decisions underneath — ordering, delivery, names, bounds — are in
 * lib/meetings/chat.test.ts, where they can be exercised without a DOM.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopilotSidebar } from "./MeetingRoom";
import { CHAT_MAX_LENGTH, type ChatMessage } from "@/lib/meetings/chat";

const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1", from: "p2", displayName: "Rae", text: "shall we", ts: 1_000, ...over,
});

function setup(props: Partial<React.ComponentProps<typeof CopilotSidebar>> = {}) {
  const onSendChat = jest.fn();
  const onRetryChat = jest.fn();
  const onChatVisibility = jest.fn();
  render(
    <CopilotSidebar
      srStatus="active"
      participants={[{ id: "p1", displayName: "Alina", micOn: true, isLocal: true }]}
      speaking={new Set()}
      roomCode="abc-defg-hij"
      meetingTitle="Fund IV sync"
      chatMessages={[]}
      chatUnread={0}
      onSendChat={onSendChat}
      onRetryChat={onRetryChat}
      isHost
      raisedHands={new Set()}
      onKick={jest.fn()}
      onAdmit={jest.fn()}
      onDeny={jest.fn()}
      onAdmitAll={jest.fn()}
      waitingPeers={[]}
      onChatVisibility={onChatVisibility}
      onCollapse={jest.fn()}
      {...props}
    />,
  );
  return { onSendChat, onRetryChat, onChatVisibility, user: userEvent.setup() };
}

// ── A send that failed looked exactly like a send that worked ───────────────

describe("delivery state", () => {
  it("says nothing about a message that went out", () => {
    setup({ chatMessages: [message({ delivery: "sent" })] });
    expect(screen.queryByText("Not delivered")).not.toBeInTheDocument();
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
  });

  it("shows a message still in flight", () => {
    setup({ chatMessages: [message({ delivery: "sending" })] });
    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  // The defect: the panel used to render this identically to a delivered one,
  // so somebody watched their own words in a room that never got them.
  it("says so when the socket refused it, and offers to send it again", async () => {
    const { onRetryChat, user } = setup({ chatMessages: [message({ id: "m9", delivery: "failed" })] });
    expect(screen.getByText("Not delivered")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetryChat).toHaveBeenCalledWith("m9");
  });

  // A message someone else sent arrived by definition; marking it would be
  // noise on every line of the conversation.
  it("marks nothing on a received message", () => {
    setup({ chatMessages: [message()] });
    expect(screen.queryByText("Sending…")).not.toBeInTheDocument();
    expect(screen.queryByText("Not delivered")).not.toBeInTheDocument();
  });
});

// ── There was nowhere an unread count could appear ──────────────────────────

describe("unread", () => {
  it("reports the chat as visible on mount", () => {
    const { onChatVisibility } = setup();
    expect(onChatVisibility).toHaveBeenLastCalledWith(true);
  });

  // The defect: only "the chat is open" was ever reported, so every message
  // that arrived while somebody read the roster counted as read.
  it("reports the chat as hidden once another tab is chosen", async () => {
    const { onChatVisibility, user } = setup();
    await user.click(screen.getByRole("button", { name: /People/ }));
    expect(onChatVisibility).toHaveBeenLastCalledWith(false);
  });

  it("badges the Chat tab while another tab is showing", async () => {
    const { user } = setup({ chatUnread: 3 });
    await user.click(screen.getByRole("button", { name: /People/ }));
    expect(screen.getByTitle("3 unread")).toHaveTextContent("3");
  });

  it("does not badge the tab being looked at", () => {
    setup({ chatUnread: 3 });
    expect(screen.queryByTitle("3 unread")).not.toBeInTheDocument();
  });
});

// ── Text arrived unbounded and was rendered unbounded ───────────────────────

describe("message text", () => {
  it("bounds what can be typed", () => {
    setup();
    expect(screen.getByPlaceholderText("Message everyone…")).toHaveAttribute(
      "maxlength", String(CHAT_MAX_LENGTH),
    );
  });

  // jsdom cannot see the overflow this prevents — it has no layout engine —
  // so what is pinned here is that the rule is present on the element that
  // carries the text. MeetingRoom.chat.visual.test.ts measures the result.
  it("lets a long unbroken word break", () => {
    setup({ chatMessages: [message({ text: "https://example.com/" + "a".repeat(120) })] });
    const bubble = screen.getByText(/^https:\/\/example\.com\//);
    expect(bubble.className).toContain("break-words");
  });

  it("sends the trimmed text and clears the box", async () => {
    const { onSendChat, user } = setup();
    const box = screen.getByPlaceholderText("Message everyone…");
    await user.type(box, "  ship it  ");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSendChat).toHaveBeenCalledWith("ship it");
    expect(box).toHaveValue("");
  });
});

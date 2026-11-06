/**
 * The in-call chat's additions: the Transcript tab beside it, the host's pin,
 * and private messages to one person.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CopilotSidebar, type LiveTranscriptLine } from "./CallParts";
import type { ChatMessage } from "@/lib/meetings/chat";

const PEOPLE = [
  { id: "me", displayName: "Alex", micOn: true, isLocal: true },
  { id: "p2", displayName: "Rae", micOn: true, isLocal: false },
  { id: "p3", displayName: "Tom", micOn: true, isLocal: false },
];

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: "m1", from: "p2", displayName: "Rae", text: "agenda: https://x.test/a", ts: 1_000, ...over,
});

function props(over: Partial<React.ComponentProps<typeof CopilotSidebar>> = {}) {
  return {
    srStatus: "active" as const,
    participants: PEOPLE,
    roomCode: "abc-defg-hij",
    meetingTitle: "Fund IV sync",
    chatMessages: [msg()],
    chatUnread: 0,
    onSendChat: jest.fn(),
    onRetryChat: jest.fn(),
    isHost: true,
    raisedHands: new Set<string>(),
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

describe("the Transcript tab", () => {
  const lines: LiveTranscriptLine[] = [
    { id: "t1", speakerId: "p2", speaker: "Rae", text: "Let's hold at forty.", ts: 2_000, final: true, isLocal: false },
    { id: "t2", speakerId: "me", speaker: "Alex", text: "agreed and", ts: 3_000, final: false, isLocal: true },
  ];

  it("shows what is being said, attributed, beside the chat", async () => {
    render(<CopilotSidebar {...props({ transcriptLines: lines })} />);
    await userEvent.click(screen.getByRole("button", { name: "Transcript" }));
    expect(screen.getByText("Let's hold at forty.")).toBeInTheDocument();
    expect(screen.getByText("Rae")).toBeInTheDocument();
    // Your own words under "You", still being heard.
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("agreed and")).toHaveClass("italic");
  });

  it("says when nothing has been heard yet", async () => {
    render(<CopilotSidebar {...props()} />);
    await userEvent.click(screen.getByRole("button", { name: "Transcript" }));
    expect(screen.getByText(/Nothing transcribed yet/)).toBeInTheDocument();
  });
});

describe("pinning", () => {
  it("lets the host pin a message, and shows the pin above the chat", async () => {
    const onPinChat = jest.fn();
    const { rerender } = render(<CopilotSidebar {...props({ onPinChat })} />);
    await userEvent.click(screen.getByRole("button", { name: "📌 Pin" }));
    expect(onPinChat).toHaveBeenCalledWith("m1");

    rerender(<CopilotSidebar {...props({ onPinChat, pinnedChatId: "m1" })} />);
    expect(screen.getByText(/Pinned · Rae/)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("button", { name: "Unpin" })[0]);
    expect(onPinChat).toHaveBeenLastCalledWith(null);
  });

  it("shows the pin to everyone, and the pin controls to nobody but the host", () => {
    render(<CopilotSidebar {...props({ isHost: false, pinnedChatId: "m1" })} />);
    expect(screen.getByText(/Pinned · Rae/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pin|Unpin/ })).toBeNull();
  });
});

describe("private messages", () => {
  it("sends to one person when they are picked", async () => {
    const onSendChat = jest.fn();
    render(<CopilotSidebar {...props({ onSendChat, privateReady: new Set(["p2"]) })} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Send to" }), "p2");
    const box = screen.getByPlaceholderText("Private message to Rae…");
    await userEvent.type(box, "just you{Enter}");
    expect(onSendChat).toHaveBeenCalledWith("just you", "p2");
  });

  it("sends to the room by default", async () => {
    const onSendChat = jest.fn();
    render(<CopilotSidebar {...props({ onSendChat })} />);
    await userEvent.type(screen.getByPlaceholderText("Message everyone…"), "hello all{Enter}");
    expect(onSendChat).toHaveBeenCalledWith("hello all");
  });

  it("will not offer somebody who cannot receive one", () => {
    render(<CopilotSidebar {...props({ privateReady: new Set(["p2"]) })} />);
    const picker = screen.getByRole("combobox", { name: "Send to" });
    expect(within(picker).getByRole("option", { name: /Tom/ })).toBeDisabled();
    expect(within(picker).getByRole("option", { name: /Rae/ })).not.toBeDisabled();
  });

  it("labels a private line with who else can read it, which is nobody", () => {
    render(
      <CopilotSidebar
        {...props({
          chatMessages: [
            msg({ id: "x1", from: "p2", displayName: "Rae", text: "psst", privateWith: { id: "p2", name: "Rae", direction: "in" } }),
            msg({ id: "x2", from: "me", displayName: "Alex", text: "ok", ts: 900_000, privateWith: { id: "p2", name: "Rae", direction: "out" } }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Private to you")).toBeInTheDocument();
    expect(screen.getByText("Private to Rae")).toBeInTheDocument();
    // A private line is never pinnable.
    expect(screen.queryByRole("button", { name: "📌 Pin" })).toBeNull();
  });
});

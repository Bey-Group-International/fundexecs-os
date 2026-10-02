/**
 * The call's control bar.
 *
 * What these pin is the reorganisation: the panel is reached by a button per
 * tab rather than one "Copilot" toggle, so each tab keeps its own badge — in
 * particular, unread chat is no longer hidden while someone waits to join —
 * and the controls that do not fit a phone are in More rather than gone.
 *
 * Rendered directly, as HostExitControl and CopilotSidebar are: reaching the
 * bar through MeetingRoom means entering a room.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ControlBar } from "./CallParts";

type Props = React.ComponentProps<typeof ControlBar>;

function setup(over: Partial<Props> = {}) {
  const handlers = {
    onToggleMic: jest.fn(), onToggleCam: jest.fn(), onToggleScreen: jest.fn(), onOpenPanel: jest.fn(),
    onLeave: jest.fn(), onEndForAll: jest.fn(), onSwitchMic: jest.fn(), onSwitchCam: jest.fn(),
    onSwitchSpeaker: jest.fn(), onRaiseHand: jest.fn(), onReaction: jest.fn(), onMuteAll: jest.fn(),
    onToggleLayout: jest.fn(), onFlipCamera: jest.fn(), onOpenBackgrounds: jest.fn(), onToggleRecording: jest.fn(),
  };
  render(
    <ControlBar
      micOn camOn shareOn={false} shareStarting={false} isHost={false} handRaised={false}
      panel={null} canShareDocs participantCount={3}
      handsUp={0} handsUpNote="" layout="grid" layoutForced={false} chatUnread={0} waitingCount={0}
      elapsed={{ current: { spans: [], openedAt: null } }}
      roomCode="abc-defg-hij" bwMode="normal" activeMicId="" activeCamId="" camStarting={false}
      leaving={false} backgroundActive={false} backgroundBtnRef={{ current: null }}
      recordingState="idle" recordingBy="" recordingStartedAt={null}
      {...handlers}
      {...over}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

describe("the panel buttons", () => {
  it("opens the panel on the tab each one names", async () => {
    const { onOpenPanel, user } = setup();
    await user.click(screen.getByRole("button", { name: "Chat" }));
    await user.click(screen.getByRole("button", { name: /^People/ }));
    await user.click(screen.getByRole("button", { name: "Documents" }));
    expect(onOpenPanel.mock.calls).toEqual([["chat"], ["people"], ["docs"]]);
  });

  it("no longer calls anything Copilot", () => {
    setup();
    expect(screen.queryByText(/copilot/i)).not.toBeInTheDocument();
  });

  it("shows unread chat while someone is waiting to join", () => {
    setup({ isHost: true, chatUnread: 4, waitingCount: 2 });
    expect(screen.getByRole("button", { name: "Chat, 4 unread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "People, 2 waiting to join" })).toBeInTheDocument();
  });

  it("drops the unread badge while the chat is the tab showing", () => {
    setup({ chatUnread: 4, panel: "chat" });
    const chat = screen.getByRole("button", { name: "Chat" });
    expect(chat).toHaveAttribute("aria-pressed", "true");
    expect(within(chat).queryByText("4")).not.toBeInTheDocument();
  });

  it("offers a guest no Documents button", () => {
    setup({ canShareDocs: false });
    expect(screen.queryByRole("button", { name: "Documents" })).not.toBeInTheDocument();
  });

  it("says how many are in the call when nobody is waiting", () => {
    setup({ participantCount: 5 });
    expect(screen.getByRole("button", { name: "People, 5 in the call" })).toBeInTheDocument();
  });
});

describe("the microphone and camera", () => {
  it("are named by what pressing them does, not by a guess from their state", () => {
    setup({ micOn: false, micTitle: "No microphone — retry", camOn: false, camTitle: "No camera — retry" });
    expect(screen.getByRole("button", { name: "No microphone — retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No camera — retry" })).toBeInTheDocument();
  });
});

describe("More", () => {
  it("holds the host's Mute everyone and the invite link", async () => {
    const { onMuteAll, user } = setup({ isHost: true });
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("menuitem", { name: /copy invite link/i })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /mute everyone/i }));
    expect(onMuteAll).toHaveBeenCalled();
    // Acting from the menu closes it: it portals over the ending overlay.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("does not offer a guest the host's tools", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.queryByRole("menuitem", { name: /mute everyone/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /record/i })).not.toBeInTheDocument();
  });

  it("anchors the background picker to More when it is opened from there", async () => {
    const ref: { current: HTMLButtonElement | null } = { current: null };
    const { onOpenBackgrounds, user } = setup({ backgroundBtnRef: ref });
    const more = screen.getByRole("button", { name: "More options" });
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: /background effects/i }));
    expect(onOpenBackgrounds).toHaveBeenCalled();
    expect(ref.current).toBe(more);
  });
});

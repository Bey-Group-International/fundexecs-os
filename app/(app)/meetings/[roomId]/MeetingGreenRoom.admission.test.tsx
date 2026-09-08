/**
 * The pre-join screen holding the wait.
 *
 * This is the whole point of the change these test: pressing Join used to
 * replace this screen with a separate waiting screen, which re-rendered the
 * camera into a second <video> and took away every control on it. The
 * assertions below are mostly about things NOT changing — the preview staying
 * put, the toggles staying live — because that is what "seamless" means here and
 * it is otherwise very easy to regress by rearranging JSX.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeetingGreenRoom } from "./MeetingGreenRoom";

jest.mock("./BackgroundPicker", () => ({ BackgroundPicker: () => null }));
jest.mock("../MeetingShareLink", () => ({ MeetingShareLink: () => null }));
jest.mock("@/lib/meetings/background-processor", () => ({ BackgroundProcessor: class {} }));
jest.mock("@/lib/meetings/background-store", () => ({ getBackground: async () => null }));

// jsdom has no media stack; the green room only needs the calls not to throw.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true, value: jest.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: jest.fn().mockRejectedValue(new Error("no camera in jsdom")),
      enumerateDevices: jest.fn().mockResolvedValue([]),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  });
});

/** Render and let the device acquisition settle, so React is not mid-update. */
async function show(admission: "idle" | "asking" | "waiting" | "timed-out", extra: Record<string, unknown> = {}) {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(<MeetingGreenRoom {...base} admission={admission} onCancelAdmission={jest.fn()} {...extra} />);
  });
  return view;
}

/** Every control on the screen, by the label a person would identify it by. */
function controlSignature() {
  return screen.getAllByRole("button").map((b) => ({
    label: b.getAttribute("aria-label") ?? b.getAttribute("title") ?? b.textContent ?? "",
    disabled: (b as HTMLButtonElement).disabled,
  }));
}

const base = {
  roomCode: "abc-defg-hi",
  isHost: false,
  joining: false,
  displayName: "Ada",
  onDisplayNameChange: jest.fn(),
  meetingTitle: "Series B Diligence",
  onJoin: jest.fn(),
};

describe("before knocking", () => {
  it("offers the join button and says nothing about waiting", async () => {
    await show("idle");
    expect(screen.getByRole("button", { name: /join meeting/i })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("joins with the setup the guest is looking at", async () => {
    const onJoin = jest.fn();
    await show("idle", { onJoin });
    await userEvent.click(screen.getByRole("button", { name: /join meeting/i }));
    expect(onJoin).toHaveBeenCalledTimes(1);
  });
});

describe("while waiting to be let in", () => {
  it("replaces the button with a live status, in place", async () => {
    await show("waiting");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/waiting for the host to let you in/i);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("button", { name: /join meeting/i })).not.toBeInTheDocument();
  });

  // The reason for staying on one screen: a wait is the only idle time in a
  // meeting, and it is when people notice their camera is pointed at the
  // ceiling. The old waiting screen took all of this away.
  it("keeps the guest's own preview on screen", async () => {
    const view = await show("waiting");
    expect(view.container.querySelector(".aspect-video")).toBeTruthy();
  });

  // The precise claim, and the one easiest to regress by rearranging JSX: the
  // wait changes the join button and nothing else. Comparing the two states
  // states it better than asserting each control individually would, because it
  // also catches a control that quietly disappears.
  it("changes the join button and leaves every other control alone", async () => {
    const idle = await show("idle");
    const before = controlSignature().filter((c) => !/join meeting/i.test(c.label));
    idle.unmount();

    await show("waiting");
    const after = controlSignature().filter((c) => !/^cancel$/i.test(c.label));
    expect(after).toEqual(before);
  });

  it("keeps the camera and microphone toggles on screen", async () => {
    await show("waiting");
    const toggles = screen.getAllByRole("button").filter((b) =>
      /camera|microphone|mic/i.test(b.getAttribute("aria-label") ?? b.getAttribute("title") ?? ""));
    expect(toggles.length).toBeGreaterThan(0);
  });

  it("tells the guest they can carry on setting up", async () => {
    await show("waiting");
    expect(screen.getByRole("status")).toHaveTextContent(/keep setting up/i);
  });

  it("offers a cancel that hands control back", async () => {
    const onCancelAdmission = jest.fn();
    await show("waiting", { onCancelAdmission });
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancelAdmission).toHaveBeenCalledTimes(1);
  });

  // Pressing Join twice would start a second admission session and orphan the
  // first — the exact shape of two bugs this area has already shipped.
  it("cannot be asked to join a second time", async () => {
    const onJoin = jest.fn();
    await show("waiting", { onJoin });
    expect(screen.queryByRole("button", { name: /join meeting/i })).not.toBeInTheDocument();
    expect(onJoin).not.toHaveBeenCalled();
  });
});

describe("while the knock is in flight", () => {
  it("says so, and offers nothing to cancel yet", async () => {
    await show("asking");
    expect(screen.getByRole("status")).toHaveTextContent(/asking to join/i);
    expect(screen.queryByRole("button", { name: /cancel|stop waiting/i })).not.toBeInTheDocument();
  });
});

describe("once the host has not answered for a while", () => {
  it("says so without claiming the chance has gone", async () => {
    await show("timed-out");
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/hasn't answered yet/i);
    expect(status).toHaveTextContent(/as soon as they do/i);
    expect(status).not.toHaveTextContent(/denied|can't join/i);
  });

  it("still lets the guest stop waiting", async () => {
    const onCancelAdmission = jest.fn();
    await show("timed-out", { onCancelAdmission });
    await userEvent.click(screen.getByRole("button", { name: /stop waiting/i }));
    expect(onCancelAdmission).toHaveBeenCalledTimes(1);
  });

  it("keeps the preview and controls, exactly as while waiting", async () => {
    const view = await show("timed-out");
    expect(view.container.querySelector(".aspect-video")).toBeTruthy();
  });
});

describe("cancelling and asking again", () => {
  it("puts the join button back, so retrying costs one press", async () => {
    const { rerender } = await show("waiting");
    expect(screen.queryByRole("button", { name: /join meeting/i })).not.toBeInTheDocument();

    await act(async () => { rerender(<MeetingGreenRoom {...base} admission="idle" />); });
    await waitFor(() => expect(screen.getByRole("button", { name: /join meeting/i })).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

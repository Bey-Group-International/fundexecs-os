/**
 * The lobby's quick paths: joining from whatever was pasted, starting an
 * instant meeting with its link already copied, the device check, and the
 * booking link in the toolbar.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn(), refresh: jest.fn() }),
}));
const copyText = jest.fn(async (_text: string) => true);
jest.mock("./MeetingShareLink", () => ({ copyText: (text: string) => copyText(text) }));

import { MeetingLobby } from "./MeetingLobby";

beforeEach(() => {
  push.mockReset();
  copyText.mockClear();
  global.fetch = (async (url: string) => {
    if (url === "/api/meetings/create") {
      return { ok: true, json: async () => ({ id: "m1", roomCode: "new-room-123" }) };
    }
    return { ok: false, json: async () => null };
  }) as unknown as typeof fetch;
});

function join(value: string) {
  fireEvent.change(screen.getByLabelText("Meeting code or link"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Join" }));
}

describe("joining", () => {
  it("goes to the room a pasted link points at", () => {
    render(<MeetingLobby />);
    join("https://app.fundexecs.com/meeting-invite/abc-defg-hij?ref=email");
    expect(push).toHaveBeenCalledWith("/meetings/abc-defg-hij");
  });

  it("still takes a typed code", () => {
    render(<MeetingLobby />);
    join(" ABC-DEFG-HIJ ");
    expect(push).toHaveBeenCalledWith("/meetings/abc-defg-hij");
  });

  it("says what is wrong rather than opening a room that cannot exist", () => {
    render(<MeetingLobby />);
    join("https://app.fundexecs.com/dashboard");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/doesn't look like a meeting code or link/);
  });
});

describe("an instant meeting", () => {
  it("copies the room's invite link before going in", async () => {
    render(<MeetingLobby />);
    fireEvent.click(screen.getByRole("button", { name: /new meeting/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /start an instant meeting/i }));
    });
    expect(copyText).toHaveBeenCalledWith(expect.stringMatching(/\/meeting-invite\/new-room-123$/));
    expect(push).toHaveBeenCalledWith("/meetings/new-room-123");
    expect(screen.getByRole("status")).toHaveTextContent(/invite link copied/i);
  });

  it("goes in anyway when the clipboard says no", async () => {
    copyText.mockResolvedValueOnce(false);
    render(<MeetingLobby />);
    fireEvent.click(screen.getByRole("button", { name: /new meeting/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /start an instant meeting/i }));
    });
    expect(push).toHaveBeenCalledWith("/meetings/new-room-123");
    expect(screen.getByRole("status")).not.toHaveTextContent(/copied/i);
  });
});

describe("the rest of the toolbar", () => {
  it("offers a camera and mic check without joining anything", () => {
    render(<MeetingLobby />);
    fireEvent.click(screen.getByRole("button", { name: /new meeting/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /test your camera & mic/i }));
    expect(push).toHaveBeenCalledWith("/meetings/device-check");
  });

  it("keeps Calls and Calendar named when they shrink to icons", () => {
    render(<MeetingLobby />);
    expect(screen.getByRole("link", { name: "Calls" })).toHaveAttribute("href", "/meetings/calls");
    expect(screen.getByRole("button", { name: "Calendar" })).toBeInTheDocument();
  });

  it("draws the booking link it is given into the toolbar", () => {
    render(<MeetingLobby booking={<button type="button">Copy booking link</button>} />);
    expect(screen.getByRole("button", { name: "Copy booking link" })).toBeInTheDocument();
  });
});

/**
 * The screens on the outside of a meeting.
 *
 * These are the ones nobody sees fail. A host never watches the waiting screen —
 * they are inside the meeting — so every bug here was reported, if at all, as
 * "the link didn't work". Two of the assertions below are direct regression
 * guards for bugs that shipped: Cancel that did nothing, and a deny answered
 * with a login page.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GuestThanksScreen,
  NotAdmittedScreen,
  WaitingRoomBar,
  WaitingRoomScreen,
  type WaitingPeer,
} from "./WaitingScreens";

// jsdom implements no media pipeline: play() rejects with "Not implemented" and
// noisily. The component already tolerates a failed play (autoplay races are
// normal in browsers too); this just keeps the log readable.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: jest.fn().mockResolvedValue(undefined),
  });
});

const peer = (over: Partial<WaitingPeer> = {}): WaitingPeer => ({
  id: "adm-1", from: "guest-key-1", displayName: "Ada", ...over,
});

describe("WaitingRoomScreen", () => {
  const props = {
    meetingTitle: "Series B Diligence",
    displayName: "Ada",
    previewStream: null,
    timedOut: false,
    onLeave: jest.fn(),
  };

  it("names the meeting the guest is waiting for", () => {
    render(<WaitingRoomScreen {...props} />);
    expect(screen.getByText("Series B Diligence")).toBeInTheDocument();
    expect(screen.getByText(/waiting for host to admit you/i)).toBeInTheDocument();
  });

  // The bug: Cancel stopped the poll but left this screen up, so the guest
  // stared at "Waiting for host to admit you…" over a dead camera forever.
  it("leaves when Cancel is pressed", async () => {
    const onLeave = jest.fn();
    render(<WaitingRoomScreen {...props} onLeave={onLeave} />);
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("shows the guest their own name", () => {
    render(<WaitingRoomScreen {...props} displayName="Grace Hopper" />);
    expect(screen.getByText(/Grace Hopper \(You\)/)).toBeInTheDocument();
  });

  it("falls back to 'You' when the guest gave no name", () => {
    render(<WaitingRoomScreen {...props} displayName="" />);
    expect(screen.getByText(/^You \(You\)$/)).toBeInTheDocument();
  });

  it("says the camera is off rather than showing a black rectangle", () => {
    render(<WaitingRoomScreen {...props} previewStream={null} />);
    expect(screen.getByText(/camera off/i)).toBeInTheDocument();
    expect(screen.queryByTestId("preview-video")).not.toBeInTheDocument();
  });

  it("previews the camera when there is a stream", () => {
    render(<WaitingRoomScreen {...props} previewStream={{} as MediaStream} />);
    expect(screen.getByTestId("preview-video")).toBeInTheDocument();
    expect(screen.queryByText(/camera off/i)).not.toBeInTheDocument();
  });

  describe("once the wait has gone on too long", () => {
    it("says the host has not responded", () => {
      render(<WaitingRoomScreen {...props} timedOut />);
      expect(screen.getByText(/host hasn't responded/i)).toBeInTheDocument();
      expect(screen.queryByText(/waiting for host to admit you/i)).not.toBeInTheDocument();
    });

    // The poll keeps running past the timeout, so a late host still gets their
    // guest in. The copy must not claim the chance is gone.
    it("does not tell the guest the meeting is closed to them", () => {
      render(<WaitingRoomScreen {...props} timedOut />);
      expect(screen.getByText(/you can try again/i)).toBeInTheDocument();
    });

    it("still offers a way out", async () => {
      const onLeave = jest.fn();
      render(<WaitingRoomScreen {...props} timedOut onLeave={onLeave} />);
      await userEvent.click(screen.getByRole("button", { name: /leave/i }));
      expect(onLeave).toHaveBeenCalledTimes(1);
    });
  });
});

describe("NotAdmittedScreen", () => {
  const props = { meetingTitle: "Series B Diligence", roomCode: "abc-defg-hi", onLeave: jest.fn() };

  it("tells the guest they were turned away, and by whom", () => {
    render(<NotAdmittedScreen {...props} />);
    expect(screen.getByRole("heading", { name: /you weren't admitted/i })).toBeInTheDocument();
    expect(screen.getByText(/the host didn't let you into/i)).toBeInTheDocument();
    expect(screen.getByText(/Series B Diligence/)).toBeInTheDocument();
  });

  // The bug: a denied guest was pushed at /meetings, which is inside the signed-in
  // app — so being turned away was answered with a login form. The only page a
  // guest can actually reach is the public invitation.
  it("sends the guest back to the public invitation, not into the app", () => {
    render(<NotAdmittedScreen {...props} />);
    const back = screen.getByRole("link", { name: /back to the invitation/i });
    expect(back).toHaveAttribute("href", "/meeting-invite/abc-defg-hi");

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("href")).not.toBe("/meetings");
      expect(link.getAttribute("href")).not.toBe("/login");
    }
  });

  it("does not ask the guest to sign in", () => {
    render(<NotAdmittedScreen {...props} />);
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
  });

  it("leaves when Leave is pressed", async () => {
    const onLeave = jest.fn();
    render(<NotAdmittedScreen {...props} onLeave={onLeave} />);
    await userEvent.click(screen.getByRole("button", { name: /leave/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe("GuestThanksScreen", () => {
  it("thanks the guest and offers both ways in", () => {
    render(<GuestThanksScreen onLeave={jest.fn()} />);
    expect(screen.getByRole("heading", { name: /thanks for joining/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /request access/i })).toHaveAttribute("href", "/request-access");
    expect(screen.getByRole("link", { name: /already have an account/i })).toHaveAttribute("href", "/login");
  });

  it("leaves without signing up", async () => {
    const onLeave = jest.fn();
    render(<GuestThanksScreen onLeave={onLeave} />);
    await userEvent.click(screen.getByRole("button", { name: /no thanks, leave/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});

describe("WaitingRoomBar", () => {
  const handlers = () => ({ onAdmit: jest.fn(), onDeny: jest.fn(), onAdmitAll: jest.fn() });

  it("shows nothing at all when nobody is waiting", () => {
    const { container } = render(<WaitingRoomBar waitingPeers={[]} {...handlers()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names one waiting person in the singular", () => {
    render(<WaitingRoomBar waitingPeers={[peer()]} {...handlers()} />);
    expect(screen.getByRole("region", { name: "1 person waiting to join" })).toBeInTheDocument();
    expect(screen.getByText("Waiting to join")).toBeInTheDocument();
    expect(screen.getByText("Ada")).toBeInTheDocument();
  });

  it("counts several in the plural", () => {
    render(<WaitingRoomBar waitingPeers={[peer(), peer({ id: "adm-2", displayName: "Alan" })]} {...handlers()} />);
    expect(screen.getByRole("region", { name: "2 people waiting to join" })).toBeInTheDocument();
    expect(screen.getByText("2 waiting to join")).toBeInTheDocument();
  });

  // The decision is written by admissions row id, not by guest key. Passing the
  // wrong one would 400 on the route and strand the guest with the host none the
  // wiser, so it is worth pinning.
  it("admits by admissions row id, not by guest key", async () => {
    const h = handlers();
    render(<WaitingRoomBar waitingPeers={[peer({ id: "adm-1", from: "guest-key-1" })]} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: /admit ada/i }));
    expect(h.onAdmit).toHaveBeenCalledWith("adm-1");
    expect(h.onDeny).not.toHaveBeenCalled();
  });

  it("denies by admissions row id too", async () => {
    const h = handlers();
    render(<WaitingRoomBar waitingPeers={[peer({ id: "adm-1", from: "guest-key-1" })]} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: /deny ada/i }));
    expect(h.onDeny).toHaveBeenCalledWith("adm-1");
    expect(h.onAdmit).not.toHaveBeenCalled();
  });

  it("acts on the person whose button was pressed, not the first in the list", async () => {
    const h = handlers();
    render(
      <WaitingRoomBar
        waitingPeers={[peer(), peer({ id: "adm-2", from: "guest-key-2", displayName: "Alan" })]}
        {...h}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /admit alan/i }));
    expect(h.onAdmit).toHaveBeenCalledWith("adm-2");
  });

  it("offers no 'Admit all' for a single guest — it would just be a second Admit", () => {
    render(<WaitingRoomBar waitingPeers={[peer()]} {...handlers()} />);
    expect(screen.queryByRole("button", { name: /admit all/i })).not.toBeInTheDocument();
  });

  it("offers 'Admit all' once there is a queue", async () => {
    const h = handlers();
    render(<WaitingRoomBar waitingPeers={[peer(), peer({ id: "adm-2", displayName: "Alan" })]} {...h} />);
    await userEvent.click(screen.getByRole("button", { name: /admit all/i }));
    expect(h.onAdmitAll).toHaveBeenCalledTimes(1);
    expect(h.onAdmit).not.toHaveBeenCalled();
  });

  it("lists every waiting person, so nobody is hidden behind a count", () => {
    const many = ["Ada", "Alan", "Grace", "Edsger"].map((n, i) => peer({ id: `adm-${i}`, displayName: n }));
    render(<WaitingRoomBar waitingPeers={many} {...handlers()} />);
    for (const n of ["Ada", "Alan", "Grace", "Edsger"]) {
      expect(screen.getByText(n)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: /^admit (ada|alan|grace|edsger)$/i })).toHaveLength(4);
  });
});

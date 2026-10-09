/**
 * The screens on the outside of a meeting.
 *
 * These are the ones nobody sees fail. A host is inside the meeting, so every
 * bug here was reported, if at all, as "the link didn't work". The deny-screen
 * assertions below are a direct regression guard for a bug that shipped: a deny
 * answered with a login page.
 *
 * The waiting screen itself is no longer here — the pre-join screen holds the
 * wait now, and its tests live in MeetingGreenRoom.admission.test.tsx.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GuestThanksScreen,
  NotAdmittedScreen,
  WaitingRoomBar,
  type WaitingPeer,
} from "./WaitingScreens";

const peer = (over: Partial<WaitingPeer> = {}): WaitingPeer => ({
  id: "adm-1", from: "guest-key-1", displayName: "Ada", seenAtMs: Date.now(), ...over,
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

  // The summary of the meeting they were just in: the one thing a guest could
  // never reach, because the report page is behind the login and its RLS
  // cannot match somebody with no account.
  describe("the guest's own copy of the summary", () => {
    it("asks for the link with the room and the key, and offers it when ready", async () => {
      const requestLink = jest.fn().mockResolvedValue({ url: "https://app.test/r/report/tok", ready: true });
      render(<GuestThanksScreen onLeave={jest.fn()} roomCode="abc-defg-hi" guestKey="guest-key-1" requestLink={requestLink} />);
      expect(requestLink).toHaveBeenCalledWith("abc-defg-hi", "guest-key-1");
      const link = await screen.findByRole("link", { name: /open the meeting summary/i });
      expect(link).toHaveAttribute("href", "https://app.test/r/report/tok");
      expect(link).toHaveAttribute("target", "_blank");
      expect(screen.getByText(/is ready/i)).toBeInTheDocument();
    });

    it("says the summary is still being written when it is, and still offers the link", async () => {
      const requestLink = jest.fn().mockResolvedValue({ url: "https://app.test/r/report/tok", ready: false });
      render(<GuestThanksScreen onLeave={jest.fn()} roomCode="abc-defg-hi" guestKey="guest-key-1" requestLink={requestLink} />);
      expect(await screen.findByText(/is being written/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /open the meeting summary/i })).toHaveAttribute("href", "https://app.test/r/report/tok");
    });

    it("shows nothing about it when there is no link to give", async () => {
      const requestLink = jest.fn().mockResolvedValue(null);
      render(<GuestThanksScreen onLeave={jest.fn()} roomCode="abc-defg-hi" guestKey="guest-key-1" requestLink={requestLink} />);
      await screen.findByRole("heading", { name: /thanks for joining/i });
      expect(requestLink).toHaveBeenCalled();
      expect(screen.queryByRole("link", { name: /open the meeting summary/i })).toBeNull();
    });

    it("asks for nothing without both the room and the key", () => {
      const requestLink = jest.fn();
      render(<GuestThanksScreen onLeave={jest.fn()} roomCode="abc-defg-hi" requestLink={requestLink} />);
      expect(requestLink).not.toHaveBeenCalled();
      expect(screen.queryByRole("link", { name: /open the meeting summary/i })).toBeNull();
    });
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

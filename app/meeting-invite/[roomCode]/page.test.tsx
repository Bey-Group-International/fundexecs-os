/**
 * The page an invite link opens. One job: get a guest into the meeting in one
 * press. It used to be a chooser whose primary button was "Request access",
 * followed by a name form, and only then the room — three screens between a
 * person holding a link and the meeting on it.
 */
import { render, screen, waitFor } from "@testing-library/react";

const replaceMock = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ roomCode: "abc-def-12" }),
  useRouter: () => ({ replace: replaceMock }),
}));
const getSessionMock = jest.fn();
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: getSessionMock } }),
}));
jest.mock("@/components/Logo", () => ({ Logo: () => <span>FundExecs OS</span> }));

import MeetingInvitePage from "./page";

const fetchMock = jest.fn();

function meeting(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      id: "m1",
      title: "Series B diligence",
      status: "waiting",
      scheduledAt: "2026-10-20T15:00:00.000Z",
      durationMinutes: 30,
      timezone: "America/Chicago",
      ...over,
    }),
  };
}

beforeEach(() => {
  replaceMock.mockReset();
  getSessionMock.mockReset();
  getSessionMock.mockResolvedValue({ data: { session: null } });
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

describe("the invite page", () => {
  it("offers one press into the meeting, as a real link to the room", async () => {
    fetchMock.mockResolvedValue(meeting());
    render(<MeetingInvitePage />);

    const join = await screen.findByRole("link", { name: /^join meeting$/i });
    expect(join).toHaveAttribute("href", "/meeting-room/abc-def-12?guest=1");
    // The name is asked for on the next screen, not here.
    expect(screen.queryByPlaceholderText(/your name/i)).not.toBeInTheDocument();
    // And nothing stands in front of it: no "continue as guest" to find first,
    // and no "request access" dressed up as the way in.
    expect(screen.queryByText(/continue as guest/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /request access/i })).not.toBeInTheDocument();
  });

  it("looks the meeting up by its room code and shows what it is", async () => {
    fetchMock.mockResolvedValue(meeting());
    render(<MeetingInvitePage />);
    await screen.findByText("Series B diligence");
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/meetings/public/abc-def-12");
    expect(screen.getByRole("link", { name: /save to calendar/i })).toHaveAttribute(
      "href",
      "/api/meetings/public/abc-def-12/calendar.ics",
    );
  });

  it("sends an account holder to sign in with `next`, the parameter the login flow reads", async () => {
    fetchMock.mockResolvedValue(meeting());
    render(<MeetingInvitePage />);
    const signIn = await screen.findByRole("link", { name: /sign in/i });
    expect(signIn).toHaveAttribute("href", `/login?next=${encodeURIComponent("/meetings/abc-def-12")}`);
  });

  it("does not offer to join a meeting that has ended", async () => {
    fetchMock.mockResolvedValue(meeting({ status: "ended" }));
    render(<MeetingInvitePage />);
    await screen.findByText(/already ended/i);
    expect(screen.queryByRole("link", { name: /^join meeting$/i })).not.toBeInTheDocument();
  });

  it("says so when the link is not one", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Not found" }) });
    render(<MeetingInvitePage />);
    await waitFor(() => expect(screen.getByText(/invalid or has expired/i)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /^join meeting$/i })).not.toBeInTheDocument();
  });

  it("takes someone who is signed in straight to the member room, without a press", async () => {
    // A member pressing their own invite used to be handed the guest door.
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    fetchMock.mockResolvedValue(meeting({ status: "active" }));
    render(<MeetingInvitePage />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/meetings/abc-def-12"));
    expect(screen.queryByRole("link", { name: /^join meeting$/i })).not.toBeInTheDocument();
  });

  it("leaves a signed-out visitor on the page, with the guest link", async () => {
    fetchMock.mockResolvedValue(meeting({ status: "active" }));
    render(<MeetingInvitePage />);
    await screen.findByRole("link", { name: /^join meeting$/i });
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not send anyone into a meeting that has ended", async () => {
    getSessionMock.mockResolvedValue({ data: { session: { user: { id: "u1" } } } });
    fetchMock.mockResolvedValue(meeting({ status: "ended" }));
    render(<MeetingInvitePage />);
    await screen.findByText(/already ended/i);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("falls back to the guest page when the session cannot be read", async () => {
    getSessionMock.mockRejectedValue(new Error("storage blocked"));
    fetchMock.mockResolvedValue(meeting());
    render(<MeetingInvitePage />);
    await screen.findByRole("link", { name: /^join meeting$/i });
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { BookingRequestRow, TodayChips } from "./LobbyToday";

const REQ = {
  id: "bk1",
  eventTitle: "Intro call",
  inviteeName: "Ada",
  inviteeEmail: "ada@x.test",
  inviteeNotes: "Which fund? Fund II",
  startsAt: "2099-10-05T14:00:00.000Z",
  endsAt: "2099-10-05T14:30:00.000Z",
  createdAt: "2099-10-01T00:00:00.000Z",
};

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

it("opens the list a chip is about", () => {
  const opened: string[] = [];
  render(
    <TodayChips
      summary={{ remaining: 2, minutesLeft: 90, done: 0, prep: 1, followUps: 0, requests: 1 }}
      onOpen={(t) => opened.push(t)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "2 more today · 1h 30m" }));
  fireEvent.click(screen.getByRole("button", { name: "1 booking request" }));
  fireEvent.click(screen.getByRole("button", { name: "1 needs prep" }));
  expect(opened).toEqual(["today", "requests", "needs"]);
});

it("approves in one press", async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  const decided: string[] = [];
  render(<BookingRequestRow request={REQ} onDecided={(id) => decided.push(id)} />);
  expect(screen.getByText("Which fund? Fund II")).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "approve" });
  expect(decided).toEqual(["bk1"]);
});

it("asks before declining, and offers to approve over a clash", async () => {
  render(<BookingRequestRow request={REQ} onDecided={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Decline" }));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText(/decline and email ada/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));

  fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "Clashes with Board", overridable: true }) });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  });
  expect(screen.getByText(/clashes with board/i)).toBeTruthy();
  fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Approve anyway" }));
  });
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ action: "approve", allowConflict: true });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { ConnectionRow, InRoomLine, usePreJoinRoom } from "./PreJoinRoom";

function Harness() {
  const room = usePreJoinRoom("abc-defg-hij");
  return (
    <>
      <InRoomLine snapshot={room.snapshot} now={new Date("2026-11-06T14:00:00Z").getTime()} />
      <ConnectionRow verdict={room.verdict} checking={room.checking} onRecheck={() => void room.recheck()} />
    </>
  );
}

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

it("shows who is in and grades the connection from the same reads", async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ count: 2, hostPresent: true, startedAt: "2026-11-06T13:50:00Z", names: ["Ana", "Bo"] }),
  });
  render(<Harness />);
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
  expect(screen.getByText("Ana and Bo are in · started 10 min ago")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(document.querySelector("[data-connection]")?.getAttribute("data-connection")).toBe("good");
});

it("says offline when the server cannot be reached, and checks again on request", async () => {
  fetchMock.mockRejectedValue(new Error("down"));
  render(<Harness />);
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
  expect(screen.getByText("Offline")).toBeTruthy();
  expect(screen.queryByText(/are in/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(screen.getByText("Checking…")).toBeTruthy();
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ShareClipDialog } from "./ShareClipDialog";

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

const LIVE = {
  id: "s1",
  label: "Pricing",
  startMs: 10_000,
  endMs: 40_000,
  expiresAt: new Date(Date.now() + 6.5 * 86_400_000).toISOString(),
  revokedAt: null,
  openCount: 3,
  lastOpenedAt: null,
  createdAt: new Date().toISOString(),
};

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

it("defaults to a minute from where the viewer was, and makes a link", async () => {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === "POST" ? json({ url: "https://x/s/clip/abc", share: LIVE }) : json({ shares: [] }),
  );
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={130_400} durationMs={600_000} onClose={() => {}} />);
  expect(screen.getByLabelText("Clip start")).toHaveValue("2:10");
  expect(screen.getByLabelText("Clip end")).toHaveValue("3:10");
  fireEvent.change(screen.getByLabelText("Clip label"), { target: { value: "Pricing" } });
  fireEvent.change(screen.getByLabelText("Link expires after"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: "Make link" }));
  await waitFor(() => expect(screen.getByLabelText("Clip link")).toHaveValue("https://x/s/clip/abc"));
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(post[0]).toBe("/api/meetings/m1/recording/r1/shares");
  expect(JSON.parse(post[1].body)).toEqual({ startMs: 130_000, endMs: 190_000, label: "Pricing", days: 30 });
});

it("keeps the default end inside a short recording", () => {
  fetchMock.mockImplementation(() => json({ shares: [] }));
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={50_000} durationMs={70_000} onClose={() => {}} />);
  expect(screen.getByLabelText("Clip end")).toHaveValue("1:10");
});

it("refuses an end before the start without asking the server", async () => {
  fetchMock.mockImplementation(() => json({ shares: [] }));
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={60_000} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Clip end"), { target: { value: "0:30" } });
  fireEvent.click(screen.getByRole("button", { name: "Make link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("after the start");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});

it("lists links made, with opens and expiry, and revokes one", async () => {
  fetchMock.mockImplementation((url: string, init?: RequestInit) =>
    init?.method === "PATCH" ? json({ share: { ...LIVE, revokedAt: new Date().toISOString() } }) : json({ shares: [LIVE] }),
  );
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={0} onClose={() => {}} />);
  const list = await screen.findByRole("list", { name: "Clip links" });
  expect(within(list).getByText(/Pricing · 0:10–0:40/)).toBeInTheDocument();
  expect(within(list).getByText(/Expires in 7 days · opened 3 times/)).toBeInTheDocument();
  fireEvent.click(within(list).getByRole("button", { name: "Revoke Pricing link" }));
  await waitFor(() => expect(within(list).getByText(/Revoked/)).toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith("/api/recording-shares/s1", expect.objectContaining({ method: "PATCH" }));
});

it("closes on Escape", () => {
  fetchMock.mockImplementation(() => json({ shares: [] }));
  const onClose = jest.fn();
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={0} onClose={onClose} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

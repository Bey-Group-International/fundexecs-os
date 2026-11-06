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
  clipStatus: "ready",
  clipError: null,
  allowDownload: false,
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
  expect(JSON.parse(post[1].body)).toEqual({ startMs: 130_000, endMs: 190_000, label: "Pricing", days: 30, allowDownload: false });
  expect(screen.getByText(/being prepared/)).toBeInTheDocument();
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

it("asks for downloads only when the box is ticked", async () => {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === "POST" ? json({ url: "https://x/s/clip/abc", share: LIVE }) : json({ shares: [] }),
  );
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={0} onClose={() => {}} />);
  fireEvent.click(screen.getByLabelText("Let viewers download the clip"));
  fireEvent.click(screen.getByRole("button", { name: "Make link" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
  const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(post[1].body).allowDownload).toBe(true);
});

it("refuses a clip longer than the limit without asking the server", async () => {
  fetchMock.mockImplementation(() => json({ shares: [] }));
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={0} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText("Clip end"), { target: { value: "30:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Make link" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("at most 20 minutes");
});

it("switches downloads on an existing link", async () => {
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === "PATCH" ? json({ share: { ...LIVE, allowDownload: true } }) : json({ shares: [LIVE] }),
  );
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={0} onClose={() => {}} />);
  const box = await screen.findByLabelText("Allow downloads of Pricing");
  expect(box).not.toBeChecked();
  fireEvent.click(box);
  await waitFor(() => expect(screen.getByLabelText("Allow downloads of Pricing")).toBeChecked());
  const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(patch[1].body)).toEqual({ allowDownload: true });
});

it("shows why a clip failed and offers to try again", async () => {
  const failed = { ...LIVE, clipStatus: "failed", clipError: "Clips can only be cut from WebM recordings." };
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === "PATCH" ? json({ share: { ...failed, clipStatus: "pending", clipError: null } }) : json({ shares: [failed] }),
  );
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={0} onClose={() => {}} />);
  expect(await screen.findByText(/only be cut from WebM/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByText(/Preparing…/)).toBeInTheDocument());
  const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
  expect(JSON.parse(patch[1].body)).toEqual({ retry: true });
});

it("shows who opened a link", async () => {
  fetchMock.mockImplementation((url: string) =>
    url.endsWith("/views")
      ? json({
          views: [
            { kind: "download", viewer: "a", device: "Chrome on macOS", createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString() },
            { kind: "open", viewer: "a", device: "Chrome on macOS", createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString() },
          ],
          summary: { text: "1 open · 1 viewer · 1 download" },
        })
      : json({ shares: [LIVE] }),
  );
  render(<ShareClipDialog meetingId="m1" recordingId="r1" atMs={0} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Who opened it" }));
  const activity = await screen.findByRole("list", { name: "Link activity" });
  expect(within(activity).getByText(/Downloaded · Chrome on macOS/)).toBeInTheDocument();
  expect(within(activity).getByText("2 hours ago")).toBeInTheDocument();
  expect(screen.getByText("1 open · 1 viewer · 1 download")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/recording-shares/s1/views", expect.anything());
});

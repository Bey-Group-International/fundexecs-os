import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotesPanel } from "./NotesPanel";
import { DEFAULT_NOTETAKER } from "@/lib/meetings/notetaker";

const fetchMock = jest.fn();
const NOTES = { summary: "Talking terms.", key_points: ["Valuation ~40m"], decisions: ["Proceed to DD"], action_items: ["Ana: send model"], generatedAt: Date.now() - 120_000, lines: 8 };

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: async () => body });
}

beforeEach(() => {
  jest.useRealTimers();
  fetchMock.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  window.localStorage.clear();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.includes("/live-notes")) return respond({ notes: NOTES });
    if (url.includes("/notes")) return init?.method === "PUT" ? respond({ updatedAt: "now" }) : respond({ body: "server copy" });
    if (url.includes("/bookmarks")) return respond({ bookmarks: [{ id: "b1", at: new Date().toISOString(), label: "Pricing" }] });
    if (url.includes("/glossary")) return respond({ terms: [{ id: "t1", term: "LPAC" }] });
    return respond({});
  });
});

function setup(extra: Partial<React.ComponentProps<typeof NotesPanel>> = {}) {
  return render(
    <NotesPanel meetingId="m1" isHost={false} signedIn settings={DEFAULT_NOTETAKER} lineCount={0} onBookmark={jest.fn().mockResolvedValue(true)} {...extra} />,
  );
}

it("shows the live notes", async () => {
  setup();
  expect(await screen.findByText("Talking terms.")).toBeInTheDocument();
  expect(screen.getByText("Ana: send model")).toBeInTheDocument();
  expect(screen.getByText(/Updated 2 min ago/)).toBeInTheDocument();
});

it("asks for fresh notes on Refresh", async () => {
  setup();
  await screen.findByText("Talking terms.");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([u, i]) => String(u).includes("/live-notes") && i?.method === "POST")).toBe(true));
  const post = fetchMock.mock.calls.find(([u, i]) => String(u).includes("/live-notes") && i?.method === "POST")!;
  expect(JSON.parse(post[1].body)).toEqual({ force: true });
});

it("hides the live notes when the host keeps them", () => {
  setup({ settings: { ...DEFAULT_NOTETAKER, notesVisibility: "host" } });
  expect(screen.getByText(/keeping the live notes to themselves/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/live-notes"))).toBe(false);
});

it("loads and autosaves my notes, keeping a draft on the device", async () => {
  jest.useFakeTimers();
  setup();
  const box = (await screen.findByDisplayValue("server copy")) as HTMLTextAreaElement;
  fireEvent.change(box, { target: { value: "Ask about fees" } });
  expect(window.localStorage.getItem("fx-meeting-notes:m1")).toBe("Ask about fees");
  await act(async () => {
    jest.advanceTimersByTime(1600);
  });
  const put = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/notes") && i?.method === "PUT")!;
  expect(JSON.parse(put[1].body)).toEqual({ body: "Ask about fees" });
  await act(async () => {
    await Promise.resolve();
  });
  expect(window.localStorage.getItem("fx-meeting-notes:m1")).toBeNull();
});

it("prefers an unsaved draft over the server copy", async () => {
  window.localStorage.setItem("fx-meeting-notes:m1", "draft on device");
  setup();
  expect(await screen.findByDisplayValue("draft on device")).toBeInTheDocument();
  expect(screen.getByText(/Saved on this device/)).toBeInTheDocument();
});

it("lists bookmarks and adds one with a label", async () => {
  const onBookmark = jest.fn().mockResolvedValue(true);
  setup({ onBookmark });
  expect(await screen.findByText("Pricing")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Bookmark label"), { target: { value: "Fees agreed" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /🔖 Bookmark/ }));
  });
  expect(onBookmark).toHaveBeenCalledWith("Fees agreed");
});

it("gives a guest no notes or bookmarks", () => {
  setup({ signedIn: false });
  expect(screen.queryByLabelText("My notes")).toBeNull();
  expect(screen.queryByLabelText("Bookmark label")).toBeNull();
  expect(screen.getByText(/Sign in to keep your own notes/)).toBeInTheDocument();
});

it("gives the host the notetaker's controls", async () => {
  const onSettingsChange = jest.fn().mockResolvedValue(true);
  setup({ isHost: true, onSettingsChange });
  fireEvent.click(screen.getByRole("button", { name: "Pause notetaker" }));
  await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith({ paused: true }));
  fireEvent.change(screen.getByLabelText("Live notes visible to"), { target: { value: "host" } });
  await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith({ notesVisibility: "host" }));
  fireEvent.change(screen.getByLabelText("Transcription language"), { target: { value: "es-ES" } });
  await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith({ lang: "es-ES" }));
  fireEvent.click(screen.getByRole("button", { name: /glossary/i }));
  expect(await screen.findByText("LPAC")).toBeInTheDocument();
});

it("says when paused, and lets the host resume", async () => {
  const onSettingsChange = jest.fn().mockResolvedValue(true);
  setup({ isHost: true, onSettingsChange, settings: { ...DEFAULT_NOTETAKER, paused: true } });
  expect(screen.getAllByText(/notetaker is paused/i).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Resume notetaker" }));
  await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith({ paused: false }));
});

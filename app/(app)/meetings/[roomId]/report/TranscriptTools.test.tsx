/**
 * The transcript's tools: download, talk time, renaming speakers, quoting a
 * line and correcting one — on their own, and wired into the panel.
 */
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TranscriptPanel, type TranscriptToolsProps } from "./TranscriptPanel";
import type { TranscriptCue } from "@/lib/meetings/transcript-cues";

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

function json(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

const START = Date.parse("2026-11-06T10:00:00Z");
const ts = (s: number) => new Date(START + s * 1000).toISOString();

const CUES: TranscriptCue[] = [
  { speaker: "Speaker 1", atMs: 0, uncertain: false, overlapped: false, paragraphs: ["Where do we close?"], lineIds: ["a"], originals: [null] },
  {
    speaker: "Dana",
    atMs: 5_000,
    uncertain: false,
    overlapped: false,
    paragraphs: ["We close in March.", "Probably."],
    lineIds: ["b", "c"],
    originals: [null, null],
  },
];

function tools(over: Partial<TranscriptToolsProps> = {}): TranscriptToolsProps {
  return {
    meetingId: "m1",
    isHost: true,
    rows: [
      { id: "a", speaker: "Speaker 1", text: "Where do we close?", ts: ts(0) },
      { id: "b", speaker: "Dana", text: "We close in March.", ts: ts(5) },
      { id: "c", speaker: "Dana", text: "Probably.", ts: ts(9) },
    ],
    // "Speaker 2" was already named Dana on the server.
    speakerNames: { "Speaker 2": "Dana" },
    ...over,
  };
}

async function open(props: Partial<React.ComponentProps<typeof TranscriptPanel>> = {}) {
  const user = userEvent.setup();
  render(<TranscriptPanel transcript="" cues={CUES} onSeek={() => {}} tools={tools()} {...props} />);
  await user.click(screen.getByRole("button", { name: /Transcript/ }));
  return user;
}

it("offers a download in each format, with timestamps optional", async () => {
  const user = await open();
  await user.click(screen.getByRole("button", { name: "Download" }));
  const link = screen.getByRole("link", { name: "Download transcript" });
  expect(link).toHaveAttribute("href", "/api/meetings/m1/transcript/export?format=txt");
  await user.click(screen.getByLabelText("Include timestamps"));
  expect(link).toHaveAttribute("href", "/api/meetings/m1/transcript/export?format=txt&timestamps=0");
  await user.selectOptions(screen.getByLabelText("Download format"), "Captions (.srt)");
  expect(screen.getByRole("link", { name: "Download transcript" })).toHaveAttribute("href", "/api/meetings/m1/transcript/export?format=srt");
  expect(screen.queryByLabelText("Include timestamps")).toBeNull();
});

it("shows who did the talking", async () => {
  const user = await open();
  await user.click(screen.getByRole("button", { name: "Talk time" }));
  const list = screen.getByRole("list", { name: "Talk time by speaker" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent(/^Speaker 1\d+% · 5s · 1 turn · 1 question$/);
  expect(rows[1]).toHaveTextContent(/^Dana\d+%/);
  expect(within(list).getByText(/1 question/)).toBeInTheDocument();
});

it("lets the host rename a speaker, by the label as heard, everywhere at once", async () => {
  fetchMock.mockImplementation(() => json({ original: "Speaker 1", display: "Ann Lee" }));
  const user = await open();
  await user.click(screen.getByRole("button", { name: "Rename speakers" }));
  // Labels as heard, including the one already renamed on the server.
  expect(screen.getByLabelText("Name for Speaker 2")).toHaveValue("Dana");
  await user.type(screen.getByLabelText("Name for Speaker 1"), "Ann Lee");
  await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
  await waitFor(() => expect(screen.getAllByText("Ann Lee").length).toBeGreaterThan(0));
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/meetings/m1/transcript/speakers");
  expect(JSON.parse(init.body)).toEqual({ original: "Speaker 1", display: "Ann Lee" });
});

it("hides renaming and correcting from everyone but the host", async () => {
  await open({ tools: tools({ isHost: false }) });
  expect(screen.queryByRole("button", { name: "Rename speakers" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Correct this line" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Copy as quote" }).length).toBe(3);
});

it("lets the host correct a line, keeps what was heard, and undoes it", async () => {
  fetchMock
    .mockImplementationOnce(() => json({ lineId: "b", text: "We close in May.", original: "We close in March." }))
    .mockImplementationOnce(() => json({ lineId: "b", text: "We close in March.", original: null }));
  const user = await open();
  await user.click(screen.getAllByRole("button", { name: "Correct this line" })[1]);
  const box = screen.getByLabelText("Corrected line");
  await user.clear(box);
  await user.type(box, "We close in May.");
  await user.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(screen.getByText("We close in May.")).toBeInTheDocument());
  expect(screen.getByTitle("As heard: We close in March.")).toBeInTheDocument();
  expect(fetchMock.mock.calls[0][0]).toBe("/api/meetings/m1/transcript/lines/b");

  await user.click(screen.getByRole("button", { name: "Undo correction" }));
  await waitFor(() => expect(screen.getByText("We close in March.")).toBeInTheDocument());
  expect(screen.queryByTitle(/As heard/)).toBeNull();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ text: null });
});

it("shows the server's reason when a correction fails", async () => {
  fetchMock.mockImplementation(() => json({ error: "Only the meeting host can do that." }, 403));
  const user = await open();
  await user.click(screen.getAllByRole("button", { name: "Correct this line" })[0]);
  await user.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Only the meeting host");
});

it("copies a line as a quote with a link to its moment", async () => {
  // userEvent provides the clipboard.
  const user = await open();
  await user.click(screen.getAllByRole("button", { name: "Copy as quote" })[1]);
  await waitFor(() => expect(screen.getByText("Copied")).toBeInTheDocument());
  const quoted = await navigator.clipboard.readText();
  expect(quoted).toMatch(/^“We close in March\.” — Dana \(0:05\)\nhttp:\/\/localhost\/.*t=5$/);
});

it("renders the transcript bare without tools", async () => {
  const user = userEvent.setup();
  render(<TranscriptPanel transcript="" cues={CUES} />);
  await user.click(screen.getByRole("button", { name: /Transcript/ }));
  expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy as quote" })).toBeNull();
});

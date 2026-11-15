/**
 * A shared microphone: every line from the device is stored under its owner's
 * name, and the host says who actually spoke. The line is never rewritten; the
 * name goes beside it, and the turn splits around it.
 */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TranscriptPanel } from "./TranscriptPanel";
import type { TranscriptCue } from "@/lib/meetings/transcript-cues";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";

const CUES: TranscriptCue[] = [
  {
    speaker: "Priya", atMs: 0, uncertain: false, overlapped: false,
    paragraphs: ["Welcome everyone.", "I think we close in March.", "Agreed, then."],
    lineIds: [L1, L2, L3], originals: [null, null, null],
  },
];

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

async function setup(isHost = true) {
  render(
    <TranscriptPanel
      transcript=""
      cues={CUES}
      tools={{ meetingId: "m1", isHost, rows: [], speakerNames: {} }}
    />,
  );
  const user = userEvent.setup();
  // The transcript starts collapsed.
  await user.click(screen.getByRole("button", { name: /^Transcript/ }));
  return user;
}

// Names shown on turns, not the entries in an open speaker picker.
const speakerLabels = () =>
  screen.getAllByText(/^(Priya|Marcus Lee)$/).filter((el) => el.tagName !== "OPTION").map((el) => el.textContent);

it("says who spoke one line, and the turn splits around it", async () => {
  const user = await setup();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ lineIds: [L2], speaker: "Marcus Lee", heard: { [L2]: "Priya" } }),
  });

  await user.click(screen.getAllByRole("button", { name: "Say who said this line" })[1]);
  await user.selectOptions(screen.getByLabelText("Who said this"), "__other");
  await user.type(screen.getByLabelText("Their name"), "Marcus Lee");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(speakerLabels()).toEqual(["Priya", "Marcus Lee", "Priya"]));
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/meetings/m1/transcript/line-speakers");
  expect(JSON.parse(init.body)).toEqual({ lineIds: [L2], speaker: "Marcus Lee" });
});

it("can give the rest of the turn to the same person", async () => {
  const user = await setup();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ lineIds: [L2, L3], speaker: "Marcus Lee", heard: { [L2]: "Priya", [L3]: "Priya" } }),
  });

  await user.click(screen.getAllByRole("button", { name: "Say who said this line" })[1]);
  await user.selectOptions(screen.getByLabelText("Who said this"), "__other");
  await user.type(screen.getByLabelText("Their name"), "Marcus Lee");
  await user.click(screen.getByLabelText(/This and the 1 line after it/));
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(speakerLabels()).toEqual(["Priya", "Marcus Lee"]));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).lineIds).toEqual([L2, L3]);
});

it("puts a line back as heard", async () => {
  const user = await setup();
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ lineIds: [L2], speaker: "Marcus Lee", heard: { [L2]: "Priya" } }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ lineIds: [L2], speaker: null, heard: { [L2]: "Priya" } }) });

  const open = async () => user.click(screen.getAllByRole("button", { name: "Say who said this line" })[1]);
  await open();
  await user.selectOptions(screen.getByLabelText("Who said this"), "__other");
  await user.type(screen.getByLabelText("Their name"), "Marcus Lee");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(speakerLabels()).toEqual(["Priya", "Marcus Lee", "Priya"]));

  await user.click(screen.getAllByRole("button", { name: "Say who said this line" })[1]);
  await user.click(screen.getByRole("button", { name: "As heard" }));
  await waitFor(() => expect(speakerLabels()).toEqual(["Priya"]));
});

it("shows the server's message and leaves the transcript alone when it can't save", async () => {
  const user = await setup();
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Could not save who spoke." }) });
  await user.click(screen.getAllByRole("button", { name: "Say who said this line" })[0]);
  await user.selectOptions(screen.getByLabelText("Who said this"), "__other");
  await user.type(screen.getByLabelText("Their name"), "Sam");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save who spoke.");
  expect(speakerLabels()).toEqual(["Priya"]);
});

it("offers nothing to a reader who is not the host", async () => {
  await setup(false);
  expect(screen.queryByRole("button", { name: "Say who said this line" })).toBeNull();
});

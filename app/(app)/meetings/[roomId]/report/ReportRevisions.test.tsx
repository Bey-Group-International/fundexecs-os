/**
 * Correcting a report and going back to an earlier one.
 *
 * The properties worth a test: only the host can correct or restore, the
 * correction actually reaches the regenerate route, and the page re-reads the
 * report afterwards rather than keeping the old one on screen.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ReportRevisions } from "./ReportRevisions";

const VERSIONS = [
  { id: "r2", createdAt: "2026-10-01T11:00:00Z", summary: "New", followUp: "", correction: "Send it to Jane", restoredFrom: null, current: true },
  { id: "r1", createdAt: "2026-10-01T10:00:00Z", summary: "Old", followUp: "Hi", correction: null, restoredFrom: null, current: false },
];

function captureFetch(responses: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(
    async (url: unknown, init?: { method?: string; body?: string }) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      const json = String(url).endsWith("/versions") && !init?.method
        ? { versions: VERSIONS, canRestore: true, ...responses }
        : { ok: true, ...responses };
      return { ok: true, json: async () => json } as unknown as Response;
    },
  );
  return calls;
}

afterEach(() => jest.clearAllMocks());

it("does not offer a correction to someone who is not the host", () => {
  render(<ReportRevisions meetingId="m1" isHost={false} />);
  expect(screen.queryByText(/Correct & regenerate/)).not.toBeInTheDocument();
  expect(screen.getByText("Show history")).toBeInTheDocument();
});

it("sends the host's correction to the regenerate route and re-reads the page", async () => {
  const calls = captureFetch();
  render(<ReportRevisions meetingId="m1" isHost />);
  await userEvent.click(screen.getByText(/Correct & regenerate/));
  await userEvent.type(screen.getByLabelText(/Tell the report what it got wrong/), "The follow-up is to Jane.");
  await userEvent.click(screen.getByText("Regenerate with correction"));

  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls[0]).toEqual({
    url: "/api/meetings/m1/report/regenerate",
    method: "POST",
    body: { correction: "The follow-up is to Jane." },
  });
});

it("will not regenerate on an empty correction", async () => {
  captureFetch();
  render(<ReportRevisions meetingId="m1" isHost />);
  await userEvent.click(screen.getByText(/Correct & regenerate/));
  expect(screen.getByText("Regenerate with correction")).toBeDisabled();
});

it("lists versions and restores an earlier one", async () => {
  const calls = captureFetch();
  render(<ReportRevisions meetingId="m1" isHost />);
  await userEvent.click(screen.getByText("Show history"));

  expect(await screen.findByText("Current")).toBeInTheDocument();
  expect(screen.getByText("Send it to Jane")).toBeInTheDocument();
  // Only the older version can be restored; the current one already is.
  const restore = screen.getAllByText("Restore this version");
  expect(restore).toHaveLength(1);

  await userEvent.click(restore[0]);
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls.find((c) => c.method === "POST")).toEqual({
    url: "/api/meetings/m1/report/versions",
    method: "POST",
    body: { versionId: "r1" },
  });
});

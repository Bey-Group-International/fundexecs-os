/**
 * The stalled page's button: one POST to the regenerate route, then the
 * server decides what to show. A refusal is shown in the route's own words,
 * because "nothing was transcribed" is the honest and final answer for most
 * meetings that reach this page.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { GenerateFromTranscript } from "./GenerateFromTranscript";

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("posts to the regenerate route and hands the page back to the server", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ entry: {} }) });
  render(<GenerateFromTranscript meetingId="m1" />);
  await userEvent.click(screen.getByRole("button", { name: /generate the report/i }));

  expect(fetchMock).toHaveBeenCalledWith("/api/meetings/m1/report/regenerate", expect.objectContaining({ method: "POST" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows the route's own reason when there is nothing to write from", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({ error: "This meeting has no transcript on file, so there is nothing to analyse." }),
  });
  render(<GenerateFromTranscript meetingId="m1" />);
  await userEvent.click(screen.getByRole("button", { name: /generate the report/i }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/no transcript on file/i);
  expect(refresh).not.toHaveBeenCalled();
});

it("says so when the request never reached the server", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  render(<GenerateFromTranscript meetingId="m1" />);
  await userEvent.click(screen.getByRole("button", { name: /generate the report/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/check your connection/i);
});

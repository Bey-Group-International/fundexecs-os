/**
 * The only thing on the report page that still polls.
 *
 * It inherits the two behaviours the client page's poll was fixed for, so both
 * are asserted here rather than assumed:
 *
 *   it stops — a spinner that outlives the thing it waits for is what the wait
 *   limit exists to prevent, and
 *   it stops for EVERY terminal answer, not just a successful one. The client
 *   version polled forever for a non-attendee, because under RLS their empty
 *   report read looks exactly like one still being written.
 */

import React from "react";
import { act, render } from "@testing-library/react";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ReportWaiting, POLL_INTERVAL } from "./ReportWaiting";

const fetchMock = jest.fn();

function answers(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

/** Advance one poll interval and let its request settle. */
async function tick() {
  await act(async () => {
    jest.advanceTimersByTime(POLL_INTERVAL);
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  refresh.mockClear();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("ReportWaiting", () => {
  it("asks nothing at all until a first interval has passed", async () => {
    // The server has just told it the report is missing; asking again in the same
    // instant would only repeat a read that was taken to render this page.
    render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={60_000} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps asking while the report is still being written", async () => {
    fetchMock.mockResolvedValue(answers({ waiting: true, ready: false, state: "generating" }));
    render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={600_000} />);

    await tick();
    await tick();
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("asks the room's own status route", async () => {
    fetchMock.mockResolvedValue(answers({ waiting: true }));
    render(<ReportWaiting roomId="abc def/gh" stopAfterMs={600_000} />);
    await tick();

    const [url] = fetchMock.mock.calls[0];
    // Encoded: a room code is user-facing and goes into a path segment.
    expect(String(url)).toBe("/api/meetings/rooms/abc%20def%2Fgh/report/status");
  });

  it("refreshes and stops once the report has landed", async () => {
    fetchMock.mockResolvedValue(answers({ waiting: false, ready: true, state: "ready" }));
    render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={600_000} />);

    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);

    // Stopped: the server now owns what is on the page.
    await tick();
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops for a reader who will never be allowed to see it", async () => {
    // The defect the client poll had: a non-attendee's report read is empty under
    // RLS, which looks identical to one still being written — so they polled a
    // spinner for the life of the tab. `waiting: false` covers every terminal
    // answer, which is why this component does not distinguish them itself.
    fetchMock.mockResolvedValue(answers({ waiting: false, ready: false, state: "forbidden" }));
    render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={600_000} />);

    await tick();
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("gives up when the time it was given runs out, and hands the page back", async () => {
    fetchMock.mockResolvedValue(answers({ waiting: true }));
    render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={POLL_INTERVAL * 2} />);

    await tick();
    expect(refresh).not.toHaveBeenCalled();
    await tick();
    await tick();

    // One refresh, so the SERVER decides what a reader out of patience sees —
    // the stalled page, which is different advice rather than the same spinner.
    expect(refresh).toHaveBeenCalledTimes(1);
    const callsAtGiveUp = fetchMock.mock.calls.length;
    await tick();
    expect(fetchMock.mock.calls.length).toBe(callsAtGiveUp);
  });

  it("does not wait a fresh allowance on a report that is already late", async () => {
    // The server passes what is LEFT. Given almost nothing, it gives up at once
    // rather than granting another full wait.
    fetchMock.mockResolvedValue(answers({ waiting: true }));
    render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={1} />);

    await tick();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting through a failed request rather than giving up on it", async () => {
    // A route hiccup or an expired session costs one wasted tick. Treating it as
    // an answer would leave a real report behind a permanent spinner.
    fetchMock
      .mockResolvedValueOnce(answers({ error: "nope" }, false))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(answers({ waiting: false, ready: true }));
    render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={600_000} />);

    await tick();
    await tick();
    expect(refresh).not.toHaveBeenCalled();

    await tick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops asking when the page goes away", async () => {
    // A timer that outlives its component keeps requesting for the life of the
    // tab, and calls refresh on a router the page no longer belongs to.
    fetchMock.mockResolvedValue(answers({ waiting: true }));
    const view = render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={600_000} />);

    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    view.unmount();
    await tick();
    await tick();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders nothing of its own", async () => {
    // The spinner is the server's; this only watches.
    const { container } = render(<ReportWaiting roomId="abc-def-gh" stopAfterMs={600_000} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The meeting log's list.
 *
 * Two changes are under test here, and they are the same change seen from both
 * ends: the page now ships a LINE per meeting, and the searching and the prose
 * both come from the server.
 *
 * So the tests that earn this file are the ones about asynchrony, because that is
 * what the split introduced. A search and a detail fetch are both in flight while
 * the reader keeps typing and keeps clicking, and an answer filed against the
 * wrong question is a log showing one meeting's summary under another's heading —
 * which is indistinguishable, on screen, from the record being wrong.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeetingLogs } from "./MeetingLogs";
import { loggedMeeting, toLogEntry, type LoggedMeeting } from "@/lib/meetings/meeting-log";
import * as log from "@/lib/meetings/meeting-log";
import { fireEvent } from "@testing-library/dom";

function row(over: Partial<LoggedMeeting> = {}): LoggedMeeting {
  return {
    id: "m1",
    roomCode: "abc-123",
    title: "Dunbar Capital — Series B",
    occurredAt: "2026-09-07T14:47:00.000Z",
    durationMinutes: 45,
    attendeeCount: 2,
    counts: { keyPoints: 2, decisions: 1, actionItems: 1 },
    hasReport: true,
    canRegenerate: false,
    attended: true,
    isHost: false,
    ...over,
  };
}

const DETAIL = {
  id: "m1",
  summary: "They agreed to wire the second tranche on Friday.",
  keyPoints: ["Second tranche wiring", "Valuation at forty"],
  decisions: ["Wire Friday subject to the memo"],
  actionItems: ["Ana to circulate the valuation memo"],
  attendeeNames: ["Ana Ruiz", "Priya Shah"],
  sentiment: "positive",
};

const SNIPPET = {
  speaker: "Priya",
  parts: [
    { value: "Forty is above where we ", match: false },
    { value: "modelled", match: true },
    { value: " it.", match: false },
  ],
};

/** A fetch mock that answers by URL, and records what was asked. */
function mockFetch(handler: (url: string) => Promise<{ ok?: boolean; body: unknown }>) {
  const calls: string[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const { ok = true, body } = await handler(url);
    return { ok, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

/**
 * Let everything already in flight land.
 *
 * Needed by the two race tests, and the reason is the trap they are guarding
 * against: asserting straight after resolving a stale promise passes whether or
 * not the stale answer is discarded, because the assertion runs before the
 * answer has been processed at all. The test then agrees with the bug.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Wait past the debounce.
 *
 * A test that asserts "no request was made" sooner than the debounce asserts
 * nothing at all — it passes because the request has not had time to happen yet,
 * and it would pass just as happily against the version that does make it.
 */
const PAST_DEBOUNCE_MS = 400;

async function settleDebounce() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, PAST_DEBOUNCE_MS));
  });
}

/** A promise somebody else decides when to settle. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the list", () => {
  it("draws a row from counts, without ever having been sent the prose", () => {
    mockFetch(async () => ({ body: {} }));
    render(<MeetingLogs meetings={[row()]} />);

    expect(screen.getByText("Dunbar Capital — Series B")).toBeInTheDocument();
    // The subtitle is the counts. This is what the summary, points, decisions and
    // actions used to be shipped for.
    expect(screen.getByText(/2 key points · 1 decision · 1 action/)).toBeInTheDocument();
    expect(screen.getByText(/2 attendees/)).toBeInTheDocument();
  });

  it("asks for nothing at all to draw the list", async () => {
    // The page load is the case that has to stay free. A request per row here
    // would be a worse bargain than the payload it replaced.
    const calls = mockFetch(async () => ({ body: {} }));
    render(<MeetingLogs meetings={[row(), row({ id: "m2", title: "Second" })]} />);
    expect(screen.getByText("Second")).toBeInTheDocument();
    await settleDebounce();
    expect(calls).toEqual([]);
  });

  it("says so when there are no meetings", () => {
    mockFetch(async () => ({ body: {} }));
    render(<MeetingLogs meetings={[]} />);
    expect(screen.getByText("No meetings yet")).toBeInTheDocument();
  });
});

describe("opening a row", () => {
  it("fetches the prose and shows it", async () => {
    const calls = mockFetch(async () => ({ body: { detail: DETAIL } }));
    render(<MeetingLogs meetings={[row()]} />);

    await userEvent.click(screen.getByRole("button", { expanded: false }));

    expect(await screen.findByText("They agreed to wire the second tranche on Friday.")).toBeInTheDocument();
    expect(screen.getByText("Wire Friday subject to the memo")).toBeInTheDocument();
    expect(screen.getByText("Ana Ruiz, Priya Shah")).toBeInTheDocument();
    expect(calls).toEqual(["/api/meetings/log/m1"]);
  });

  it("files a slow answer under the meeting it describes, not the row last clicked", async () => {
    // THE test this file exists for. Open one row, open another before the first
    // answer lands, and the first answer arrives with nowhere to go. Filed by
    // request instead of by id, it lands in the open row — one meeting's summary
    // under another meeting's heading.
    const first = deferred<{ ok?: boolean; body: unknown }>();
    mockFetch(async (url) =>
      url.endsWith("/m1")
        ? first.promise
        : { body: { detail: { ...DETAIL, id: "m2", summary: "The second meeting's summary." } } },
    );

    render(<MeetingLogs meetings={[row(), row({ id: "m2", title: "Second meeting" })]} />);
    const [firstRow, secondRow] = screen.getAllByRole("button", { expanded: false });

    await userEvent.click(firstRow);
    await userEvent.click(secondRow);
    await screen.findByText("The second meeting's summary.");

    // Now the first request lands, for a row nobody is looking at.
    first.resolve({ body: { detail: DETAIL } });
    await settle();

    expect(screen.getByText("The second meeting's summary.")).toBeInTheDocument();
    expect(screen.queryByText("They agreed to wire the second tranche on Friday.")).toBeNull();
  });

  it("does not ask for a report the reader may not read", async () => {
    // A 403 is the answer, and asking for one to be told so is a request made to
    // draw a sentence the row already knows how to write.
    const calls = mockFetch(async () => ({ body: { detail: DETAIL } }));
    render(<MeetingLogs meetings={[row({ attended: false, hasReport: false })]} />);

    await userEvent.click(screen.getByRole("button", { expanded: false }));

    expect(await screen.findByText(/weren’t in this meeting/)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("says a report failed to be written, rather than that it is loading forever", async () => {
    const calls = mockFetch(async () => ({ body: { detail: DETAIL } }));
    render(<MeetingLogs meetings={[row({ hasReport: false, canRegenerate: true, isHost: true })]} />);

    await userEvent.click(screen.getByRole("button", { expanded: false }));

    expect(await screen.findByText(/the analysis didn’t finish/)).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it("does not fetch the same detail twice when a row is reopened", async () => {
    const calls = mockFetch(async () => ({ body: { detail: DETAIL } }));
    render(<MeetingLogs meetings={[row()]} />);

    const toggle = screen.getByRole("button", { expanded: false });
    await userEvent.click(toggle);
    await screen.findByText(DETAIL.summary);
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await screen.findByText(DETAIL.summary);

    expect(calls).toEqual(["/api/meetings/log/m1"]);
  });

  it("says the detail could not be read, rather than showing an empty report", async () => {
    mockFetch(async () => ({ ok: false, body: { error: "Could not load this meeting's detail." } }));
    render(<MeetingLogs meetings={[row()]} />);
    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this meeting");
  });
});

describe("searching", () => {
  it("asks the server, and shows the sentence the hit was in", async () => {
    // The capability the log did not have: "modelled" is in nobody's title.
    const calls = mockFetch(async () => ({
      body: {
        meetings: [{ ...row(), hit: { reason: "transcript", matches: 2, snippet: SNIPPET } }],
        scanned: 12,
        bounded: false,
      },
    }));
    render(<MeetingLogs meetings={[row(), row({ id: "m2", title: "Unrelated" })]} />);

    await userEvent.type(screen.getByRole("searchbox"), "modelled");

    await waitFor(() => expect(calls).toContain("/api/meetings/log/search?q=modelled"));
    expect(await screen.findByText("modelled")).toBeInTheDocument();
    expect(screen.getByText(/Priya:/)).toBeInTheDocument();
    expect(screen.getByText(/2 mentions/)).toBeInTheDocument();
    expect(screen.queryByText("Unrelated")).toBeNull();
  });

  it("marks the matched words instead of building markup out of them", async () => {
    // Other people's words. A renderer that builds HTML from them is a renderer
    // that can be made to build something else.
    mockFetch(async () => ({
      body: { meetings: [{ ...row(), hit: { reason: "transcript", matches: 1, snippet: SNIPPET } }], scanned: 1, bounded: false },
    }));
    render(<MeetingLogs meetings={[row()]} />);
    await userEvent.type(screen.getByRole("searchbox"), "modelled");

    const mark = await screen.findByText("modelled");
    expect(mark.tagName).toBe("MARK");
  });

  it("makes ONE request for a typed word, not one per keystroke", async () => {
    // Each request reads transcripts. Eight of them to answer one question is
    // the server scanning the archive eight times.
    const calls = mockFetch(async () => ({ body: { meetings: [], scanned: 0, bounded: false } }));
    render(<MeetingLogs meetings={[row()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "modelled");
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.getByText(/No matches/)).toBeInTheDocument());

    expect(calls.filter((c) => c.startsWith("/api/meetings/log/search"))).toEqual([
      "/api/meetings/log/search?q=modelled",
    ]);
  });

  it("does not let a slow earlier search replace a later one's results", async () => {
    // "val" is typed, then "valuation" before the first answer lands. Without a
    // ticket the stale answer arrives last and the reader is shown the results of
    // a question they have already refined.
    const slow = deferred<{ ok?: boolean; body: unknown }>();
    mockFetch(async (url) =>
      url.includes("q=val&") || url.endsWith("q=val")
        ? slow.promise
        : { body: { meetings: [row({ id: "late", title: "Valuation meeting" })], scanned: 2, bounded: false } },
    );

    render(<MeetingLogs meetings={[row()]} />);
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "val");
    // Let the debounce fire for "val" before finishing the word.
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBe(1));
    await userEvent.type(box, "uation");
    expect(await screen.findByText("Valuation meeting")).toBeInTheDocument();

    slow.resolve({
      body: { meetings: [row({ id: "early", title: "Stale result" })], scanned: 2, bounded: false },
    });
    await settle();

    expect(screen.getByText("Valuation meeting")).toBeInTheDocument();
    expect(screen.queryByText("Stale result")).toBeNull();
  });

  it("stops claiming a count the moment the query moves on", async () => {
    // CodeRabbit found this on the PR, and it is a real one: the count line read
    // "1 match for “dunbar”" over a box that already said "dunbar x", because the
    // claim was keyed on the last ANSWERED query and nothing on the current one.
    // The debounce is a quarter of a second, and the request is on top of that.
    mockFetch(async () => ({
      body: { meetings: [{ ...row(), hit: { reason: "metadata", matches: 0, snippet: null } }], scanned: 4, bounded: false },
    }));
    render(<MeetingLogs meetings={[row(), row({ id: "m2", title: "Unrelated" })]} />);

    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "dunbar");
    expect(await screen.findByText(/1 match for “dunbar”/)).toBeInTheDocument();

    await userEvent.type(box, " x");

    // Before the debounce has even fired, the line must stop asserting a result.
    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
    expect(screen.queryByText(/1 match for “dunbar”/)).toBeNull();
  });

  it("leaves the rows standing while the next answer is on its way", async () => {
    // The deliberate other half. Falling back to the unfiltered list would flash
    // all two hundred meetings up between two keystrokes — the reader watches
    // their results vanish and return on every letter. Stale rows under a
    // "Searching…" label are the honest version; a stale COUNT is not.
    mockFetch(async () => ({
      body: { meetings: [{ ...row(), hit: { reason: "metadata", matches: 0, snippet: null } }], scanned: 4, bounded: false },
    }));
    render(<MeetingLogs meetings={[row(), row({ id: "m2", title: "Unrelated" })]} />);

    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "dunbar");
    await screen.findByText(/1 match for “dunbar”/);

    await userEvent.type(box, " x");

    expect(screen.getByText("Dunbar Capital — Series B")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated")).toBeNull();
  });

  it("does not announce that nothing matched a query it has not answered yet", async () => {
    // A search that found nothing, then another keystroke: without this the
    // debounce is spent telling the reader "Nothing matches “dunbar x”" before
    // anything has looked.
    mockFetch(async () => ({ body: { meetings: [], scanned: 4, bounded: false } }));
    render(<MeetingLogs meetings={[row()]} />);

    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "dunbar");
    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();

    await userEvent.type(box, " x");
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  it("does not search on one character, and says why", async () => {
    // A single character matches most transcripts: the same as no filter, and a
    // great deal more reading.
    const calls = mockFetch(async () => ({ body: { meetings: [], scanned: 0, bounded: false } }));
    render(<MeetingLogs meetings={[row()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "m");

    expect(await screen.findByText(/Keep typing/)).toBeInTheDocument();
    await settleDebounce();
    expect(calls).toEqual([]);
    // And the full list is still there, rather than being filtered by a request
    // that was never made.
    expect(screen.getByText("Dunbar Capital — Series B")).toBeInTheDocument();
  });

  it("admits the bound instead of implying it read everything", async () => {
    // "No matches" over the most recent two hundred meetings is a false
    // statement, and it is the statement a plain count makes.
    mockFetch(async () => ({ body: { meetings: [], scanned: 200, bounded: true } }));
    render(<MeetingLogs meetings={[row()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "tungsten");

    expect(await screen.findByText(/in the most recent 200 meetings/)).toBeInTheDocument();
  });

  it("counts meetings, not sessions, because that is what this page lists", async () => {
    mockFetch(async () => ({ body: {} }));
    render(<MeetingLogs meetings={[row(), row({ id: "m2" })]} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 meetings");
  });

  it("puts the whole list back when the box is cleared", async () => {
    mockFetch(async () => ({
      body: { meetings: [{ ...row(), hit: { reason: "metadata", matches: 0, snippet: null } }], scanned: 2, bounded: false },
    }));
    render(<MeetingLogs meetings={[row(), row({ id: "m2", title: "Unrelated" })]} />);

    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "dunbar");
    await waitFor(() => expect(screen.queryByText("Unrelated")).toBeNull());

    await userEvent.clear(box);
    expect(await screen.findByText("Unrelated")).toBeInTheDocument();
  });

  it("says a search failed, rather than showing it as no matches", async () => {
    mockFetch(async () => ({ ok: false, body: { error: "That search could not be run." } }));
    render(<MeetingLogs meetings={[row()]} />);
    await userEvent.type(screen.getByRole("searchbox"), "dunbar");
    expect(await screen.findByRole("alert")).toHaveTextContent("That search could not be run.");
  });
});

describe("regenerating a report from a row", () => {
  it("replaces the row's counts AND its prose from the one response", async () => {
    // The response is a full entry; the row needs the numbers and the open detail
    // needs the sentences. Taking only one of the two leaves the row describing a
    // report the panel below it is not showing.
    const entry = toLogEntry(
      {
        id: "m1",
        room_code: "abc-123",
        title: "Dunbar Capital — Series B",
        created_at: "2026-09-07T14:00:00.000Z",
        started_at: "2026-09-07T14:00:00.000Z",
        ended_at: "2026-09-07T14:47:00.000Z",
        scheduled_at: null,
        duration_minutes: 45,
        status: "ended",
        attendees: [{ name: "Ana Ruiz" }, { name: "Priya Shah" }],
      },
      {
        summary: "A freshly written summary.",
        key_points: ["One", "Two", "Three"],
        action_items: [],
        analysis: { decisions: [] },
        has_transcript: true,
      },
      true,
      true,
    );

    mockFetch(async (url) =>
      url.includes("regenerate")
        ? { body: { entry } }
        : { body: { detail: DETAIL } },
    );

    render(<MeetingLogs meetings={[row({ isHost: true, canRegenerate: true, counts: { keyPoints: 0, decisions: 0, actionItems: 0 } })]} />);

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await screen.findByText(DETAIL.summary);
    await userEvent.click(screen.getByRole("button", { name: /Regenerate from transcript/ }));

    expect(await screen.findByText("A freshly written summary.")).toBeInTheDocument();
    expect(screen.getByText(/3 key points/)).toBeInTheDocument();
    // And the light row is derived from the same entry, so the two agree.
    expect(loggedMeeting(entry).counts.keyPoints).toBe(3);
  });

  it("keeps the row when regeneration fails, and says so", async () => {
    mockFetch(async (url) =>
      url.includes("regenerate")
        ? { ok: false, body: { error: "Could not regenerate the report." } }
        : { body: { detail: DETAIL } },
    );
    render(<MeetingLogs meetings={[row({ isHost: true, canRegenerate: true })]} />);

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await screen.findByText(DETAIL.summary);
    await userEvent.click(screen.getByRole("button", { name: /Regenerate from transcript/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not regenerate the report.");
    expect(screen.getByText(DETAIL.summary)).toBeInTheDocument();
  });
});

describe("the server's own list", () => {
  it("yields to new props without unmounting, so the badge and the list agree", async () => {
    // A sibling calls router.refresh() after scheduling; this component re-renders
    // with new props and must not keep its own snapshot. The count badge above it
    // reads the prop, and the two disagreeing for the rest of the session is what
    // this guards.
    mockFetch(async () => ({ body: {} }));
    const { rerender } = render(<MeetingLogs meetings={[row()]} />);
    rerender(<MeetingLogs meetings={[row(), row({ id: "m2", title: "Newly logged" })]} />);
    expect(await screen.findByText("Newly logged")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 meetings");
  });

  it("groups by the month the meeting happened in", () => {
    mockFetch(async () => ({ body: {} }));
    render(
      <MeetingLogs
        meetings={[row(), row({ id: "m2", title: "August one", occurredAt: "2026-08-03T10:00:00.000Z" })]}
      />,
    );
    const sections = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(sections).toHaveLength(2);
    expect(within(screen.getAllByRole("heading", { level: 3 })[0].parentElement!).getByText("Dunbar Capital — Series B")).toBeInTheDocument();
  });
});

// ── Typing re-rendered every row in the log ─────────────────────────────────

describe("what a keystroke costs", () => {
  /**
   * Row renders, counted through `logDateLabel` — which each row calls exactly
   * once as it renders.
   *
   * Deliberately NOT counted by watching `toLocaleDateString`. Caching the
   * formatter takes that number to zero whether or not the rows are memoized,
   * so a test watching it would pass on either change alone and guard neither.
   * This counts renders, which only the memo can change.
   */
  function countRowRenders() {
    const real = log.logDateLabel;
    let renders = 0;
    jest.spyOn(log, "logDateLabel").mockImplementation((iso: string) => {
      renders += 1;
      return real(iso);
    });
    return {
      get value() {
        return renders;
      },
      reset() {
        renders = 0;
      },
    };
  }

  const manyRows = Array.from({ length: 30 }, (_, i) =>
    row({
      id: `m${i}`,
      title: `Meeting ${i}`,
      occurredAt: new Date(Date.UTC(2026, i % 12, (i % 27) + 1, 14, 0)).toISOString(),
    }),
  );

  afterEach(() => jest.restoreAllMocks());

  // The defect: one character re-rendered every row in the log, each of them
  // re-deriving a date that had not changed. Two hundred of them, on a full page.
  it("does not re-render rows that did not change", async () => {
    mockFetch(async () => ({ body: {} }));
    const renders = countRowRenders();
    const { container } = render(<MeetingLogs meetings={manyRows} />);
    expect(renders.value).toBe(manyRows.length);

    renders.reset();
    const box = container.querySelector('input[type="search"]')!;
    // One character: below MIN_QUERY, so no search runs and this is purely the
    // re-render the keystroke causes.
    await act(async () => {
      fireEvent.change(box, { target: { value: "d" } });
    });
    expect(renders.value).toBe(0);

    renders.reset();
    await act(async () => {
      fireEvent.change(box, { target: { value: "du" } });
    });
    expect(renders.value).toBe(0);
  });

  /**
   * The companion to the one above, and the one that was missing.
   *
   * "still re-renders the row that was opened" uses a log of ONE row — and with
   * one row, "every row re-rendered" and "only the opened row re-rendered" are
   * the same observation. It therefore passed identically whether or not the
   * memo held on the open path. It did not hold: `toggle` listed `openId` and
   * `details` among its dependencies, so it was a new function every time either
   * moved, and it is handed to every row. Opening one row re-rendered all of
   * them, and the detail landing a moment later re-rendered all of them again.
   * Measured at 200 meetings: 95ms to open a row, against 15ms once `toggle`
   * stopped changing.
   *
   * Thirty rows here, because the number is the whole point: the two cases have
   * to come out as different numbers or the test is agreeing with either.
   */
  it("re-renders the opened row and leaves the rest of the log alone", async () => {
    mockFetch(async () => ({ body: { detail: DETAIL } }));
    const user = userEvent.setup();
    render(<MeetingLogs meetings={manyRows} />);

    const renders = countRowRenders();
    // `m1`, because the detail is filed under the id it names and this is the
    // row that owns it.
    await user.click(screen.getByRole("button", { name: /Meeting 1\b/ }));
    expect(await screen.findByText(DETAIL.summary)).toBeInTheDocument();

    // The opened row renders a few times over: opening it, then the detail
    // arriving. Every other row renders zero. The bound is far below the row
    // count on purpose — with the dependency array back, this is ~60.
    expect(renders.value).toBeLessThanOrEqual(6);
  });

  // The memo must not cost correctness: opening a row still re-renders THAT row.
  it("still re-renders the row that was opened", async () => {
    mockFetch(async () => ({ body: { detail: DETAIL } }));
    const user = userEvent.setup();
    render(<MeetingLogs meetings={[row()]} />);
    const renders = countRowRenders();
    await user.click(screen.getByRole("button", { name: /Dunbar Capital/ }));
    expect(renders.value).toBeGreaterThan(0);
    expect(await screen.findByText(DETAIL.summary)).toBeInTheDocument();
  });
});

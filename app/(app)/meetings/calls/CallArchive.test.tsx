/**
 * The recorded-call archive's list.
 *
 * The behaviour these lock down is what the page costs and what it claims:
 *
 *   arriving on it makes no request at all, because the list was server-rendered
 *   and the page used to immediately fetch an identical one;
 *   and a bounded search says so in the same sentence as its count, rather than
 *   in a second line a reader can skip past on the way to "No matches".
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CallArchive } from "./CallArchive";
import type { CallHit } from "@/lib/meetings/call-archive";
import * as oneWay from "@/lib/meetings/one-way";
import { fireEvent } from "@testing-library/dom";

function call(over: Partial<CallHit> = {}): CallHit {
  return {
    id: "c1",
    roomCode: "dun-bar-42",
    title: "Dunbar diligence note",
    at: "2026-09-07T14:47:00.000Z",
    durationSeconds: 754,
    summary: "Walked through the diligence note.",
    consented: true,
    matches: 0,
    snippet: null,
    ...over,
  };
}

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

/** Let everything in flight land, so an assertion is not made too early. */
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** Delete lives in the row's menu: open it, then choose Delete. */
async function askToDelete(title: string) {
  await userEvent.click(screen.getByRole("button", { name: `More actions for ${title}` }));
  await userEvent.click(screen.getByRole("menuitem", { name: new RegExp(`Delete ${title} permanently`) }));
}

afterEach(() => jest.restoreAllMocks());

describe("arriving on the page", () => {
  it("asks for nothing, because the list is already drawn", async () => {
    // The defect this exists for: the debounced search effect fired on mount with
    // an empty query, so every visit ran the same fifty-row query twice and
    // replaced the server-rendered list with an identical one.
    const calls = mockFetch(async () => ({ body: { calls: [call()], scanned: 1, bounded: false } }));
    render(<CallArchive initial={[call()]} />);

    expect(screen.getByText("Dunbar diligence note")).toBeInTheDocument();
    await settleDebounce();
    expect(calls).toEqual([]);
  });

  it("claims nothing about how many calls exist", async () => {
    // What is on screen is the first page of the archive. "50 calls" would be a
    // statement about the archive, and it would be wrong at fifty-one.
    mockFetch(async () => ({ body: {} }));
    render(<CallArchive initial={[call(), call({ id: "c2", title: "Second" })]} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("searching", () => {
  it("asks the server once the word is typed, and shows what came back", async () => {
    const calls = mockFetch(async () => ({
      body: {
        calls: [call({ id: "hit", title: "Valuation call", matches: 2 })],
        scanned: 12,
        bounded: false,
      },
    }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "valuation");

    await waitFor(() => expect(calls).toContain("/api/meetings/calls?q=valuation"));
    expect(await screen.findByText("Valuation call")).toBeInTheDocument();
    expect(screen.queryByText("Dunbar diligence note")).toBeNull();
  });

  it("makes one request for a typed word, not one per keystroke", async () => {
    const calls = mockFetch(async () => ({ body: { calls: [], scanned: 0, bounded: false } }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "valuation");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/No matches/));

    expect(calls).toEqual(["/api/meetings/calls?q=valuation"]);
  });

  it("admits the bound in the same sentence as the count", async () => {
    // Not a second paragraph underneath. "No matches" over a scan that stopped at
    // two hundred is a false statement, and a caveat below it is one a reader can
    // finish the sentence before reaching.
    mockFetch(async () => ({ body: { calls: [], scanned: 200, bounded: true } }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "tungsten");

    expect(await screen.findByText(/No matches for “tungsten” in the most recent 200 calls/))
      .toBeInTheDocument();
  });

  it("counts calls, not mentions", async () => {
    // "Which call was that in" is the question. 214 mentions across three calls
    // answers one nobody asked.
    mockFetch(async () => ({
      body: {
        calls: [call({ id: "a", matches: 120 }), call({ id: "b", matches: 94 })],
        scanned: 40,
        bounded: false,
      },
    }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "valuation");

    expect(await screen.findByText(/2 matches for “valuation”/)).toBeInTheDocument();
  });

  it("does not search on one character, and says why", async () => {
    const calls = mockFetch(async () => ({ body: { calls: [], scanned: 0, bounded: false } }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.type(screen.getByRole("searchbox"), "v");

    expect(await screen.findByText(/Keep typing/)).toBeInTheDocument();
    await settleDebounce();
    expect(calls).toEqual([]);
  });

  it("puts the whole list back when the box is cleared after a search", async () => {
    // The one case where an empty query IS worth a request: the list on screen is
    // a search result, not the one the server rendered.
    const calls = mockFetch(async (url) => ({
      body: url.endsWith("q=")
        ? { calls: [call(), call({ id: "c2", title: "Second" })], scanned: 2, bounded: false }
        : { calls: [call({ id: "hit", title: "Valuation call" })], scanned: 2, bounded: false },
    }));
    render(<CallArchive initial={[call()]} />);

    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "valuation");
    await screen.findByText("Valuation call");

    await userEvent.clear(box);

    expect(await screen.findByText("Second")).toBeInTheDocument();
    expect(calls).toContain("/api/meetings/calls?q=");
  });

  it("does not let a slow earlier search replace a later one", async () => {
    const slow = deferred<{ ok?: boolean; body: unknown }>();
    mockFetch(async (url) =>
      url.endsWith("q=val")
        ? slow.promise
        : { body: { calls: [call({ id: "late", title: "Valuation call" })], scanned: 2, bounded: false } },
    );

    render(<CallArchive initial={[call()]} />);
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "val");
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBe(1));
    await userEvent.type(box, "uation");
    expect(await screen.findByText("Valuation call")).toBeInTheDocument();

    slow.resolve({ body: { calls: [call({ id: "early", title: "Stale result" })], scanned: 2, bounded: false } });
    await settle();

    expect(screen.getByText("Valuation call")).toBeInTheDocument();
    expect(screen.queryByText("Stale result")).toBeNull();
  });
});

describe("deleting a call", () => {
  it("keeps it gone when a search answers afterwards", async () => {
    // A search already in flight when the delete lands was answered before it, and
    // must not put the recording back on screen as though it still existed.
    const slow = deferred<{ ok?: boolean; body: unknown }>();
    mockFetch(async (url) => {
      if (url.includes("/api/meetings/delete")) return { body: {} };
      return slow.promise;
    });

    render(<CallArchive initial={[call()]} />);
    const box = screen.getByRole("searchbox");
    await userEvent.type(box, "dunbar");
    await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.length).toBe(1));

    await askToDelete("Dunbar diligence note");
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() => expect(screen.queryByText("Dunbar diligence note")).toBeNull());

    slow.resolve({ body: { calls: [call()], scanned: 1, bounded: false } });
    await settle();

    expect(screen.queryByText("Dunbar diligence note")).toBeNull();
  });

  it("keeps the row when the delete fails, rather than implying it is gone", async () => {
    mockFetch(async (url) =>
      url.includes("/api/meetings/delete") ? { ok: false, body: {} } : { body: {} },
    );
    render(<CallArchive initial={[call()]} />);

    await askToDelete("Dunbar diligence note");
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be deleted");
    expect(screen.getByText("Dunbar diligence note")).toBeInTheDocument();
  });
});

// ── Typing re-rendered every row in the archive ─────────────────────────────

describe("what a keystroke costs", () => {
  /**
   * Row renders, counted through `callClock` — which each row calls once.
   *
   * Deliberately NOT counted by watching `toLocaleTimeString`. Caching the
   * formatters in `callWhen` takes those to zero whether or not the rows are
   * memoized, so a test watching them would pass on either change alone and
   * guard neither. `callClock` is pure arithmetic: only the memo moves it.
   */
  function countRowRenders() {
    const real = oneWay.callClock;
    let renders = 0;
    jest.spyOn(oneWay, "callClock").mockImplementation((s: number) => {
      renders += 1;
      return real(s);
    });
    return { get value() { return renders; }, reset() { renders = 0; } };
  }

  const manyCalls = Array.from({ length: 30 }, (_, i) =>
    call({
      id: `c${i}`,
      title: `Call ${i}`,
      at: new Date(Date.UTC(2025 + (i % 2), i % 12, (i % 27) + 1, 14, 30)).toISOString(),
    }),
  );

  afterEach(() => jest.restoreAllMocks());

  // The defect: one character re-rendered every row, each re-deriving a date
  // that had not changed — two Intl formats apiece.
  it("does not re-render rows that did not change", async () => {
    const renders = countRowRenders();
    const { container } = render(<CallArchive initial={manyCalls} />);
    expect(renders.value).toBe(manyCalls.length);

    renders.reset();
    const box = container.querySelector('input[type="search"]')!;
    // One character: below MIN_QUERY, so no request runs.
    await act(async () => {
      fireEvent.change(box, { target: { value: "d" } });
    });
    expect(renders.value).toBe(0);
  });

  // The memo must not cost correctness: asking to delete one call still
  // re-renders that row, and must not re-render the other twenty-nine.
  it("re-renders only the row whose delete was pressed", async () => {
    const user = userEvent.setup();
    render(<CallArchive initial={manyCalls} />);
    // Opening the row's menu is the row's own state; counted from after it, so
    // what is measured is the parent's `confirming` reaching the rows.
    await user.click(screen.getByRole("button", { name: "More actions for Call 7" }));
    const renders = countRowRenders();
    await user.click(screen.getByRole("menuitem", { name: /Delete Call 7 permanently/ }));
    expect(screen.getByText("Delete call and recording?")).toBeInTheDocument();
    // Exactly the one row. `< 30` would also have accepted 29, which is
    // twenty-eight unchanged rows re-rendering — an assertion that passes on
    // almost the defect it was written for.
    expect(renders.value).toBe(1);
  });
});

// ── The memo kept "Today" on a call from yesterday ──────────────────────────

describe("the day the rows are labelled against", () => {
  afterEach(() => jest.useRealTimers());

  /**
   * `callWhen` says "Today" by comparing against the moment it is CALLED, so a
   * memoized row that does not re-render keeps whatever it last said. Before
   * the memo every parent render recomputed every label, so this staleness is
   * one the optimisation introduced — which is why it is tested here rather
   * than in call-archive.test.ts: the bug is in the caching, not in the rule.
   */
  it("re-labels a call once the local day has moved on", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2026-09-29T23:50:00.000Z"));

    const { container } = render(
      <CallArchive initial={[call({ at: "2026-09-29T23:45:00.000Z" })]} />,
    );
    expect(screen.getByText(/^Today, /)).toBeInTheDocument();

    // Past midnight, and a keystroke that is NOT a search (below MIN_QUERY):
    // before the day was passed in, the memo skipped the row and it went on
    // calling yesterday's call "Today".
    jest.setSystemTime(new Date("2026-09-30T00:05:00.000Z"));
    const box = container.querySelector('input[type="search"]')!;
    await act(async () => {
      fireEvent.change(box, { target: { value: "d" } });
    });

    expect(screen.queryByText(/^Today, /)).not.toBeInTheDocument();
    expect(screen.getByText(/Sep 29/)).toBeInTheDocument();
  });

  // And the day must not cost the memo: within one day it is the same value,
  // so a keystroke still re-renders nothing.
  it("does not re-render rows for a keystroke inside the same day", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));

    const real = oneWay.callClock;
    let renders = 0;
    jest.spyOn(oneWay, "callClock").mockImplementation((n: number) => {
      renders += 1;
      return real(n);
    });

    const rows = Array.from({ length: 10 }, (_, i) => call({ id: `c${i}`, title: `Call ${i}` }));
    const { container } = render(<CallArchive initial={rows} />);
    renders = 0;

    jest.setSystemTime(new Date("2026-09-29T12:30:00.000Z"));
    const box = container.querySelector('input[type="search"]')!;
    await act(async () => {
      fireEvent.change(box, { target: { value: "d" } });
    });
    expect(renders).toBe(0);
  });
});

// ── The list around the rows ────────────────────────────────────────────────

jest.mock("../MeetingShareLink", () => ({ copyText: jest.fn(async () => true) }));
const { copyText: copyTextMock } = require("../MeetingShareLink") as { copyText: jest.Mock };

describe("headings and older calls", () => {
  afterEach(() => jest.useRealTimers());

  it("puts calls under day headings", () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date(2026, 8, 30, 12, 0));
    render(
      <CallArchive
        initial={[
          call({ id: "a", title: "Morning call", at: new Date(2026, 8, 30, 9, 0).toISOString() }),
          call({ id: "b", title: "Old call", at: new Date(2026, 7, 4, 9, 0).toISOString() }),
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "August" })).toBeInTheDocument();
  });

  it("loads the calls before the last one shown, and adds them below", async () => {
    const urls = mockFetch(async () => ({
      body: { calls: [call({ id: "older", title: "Older call", at: "2026-08-01T10:00:00.000Z" })], hasMore: false },
    }));
    render(<CallArchive initial={[call()]} initialHasMore />);

    await userEvent.click(screen.getByRole("button", { name: "Load older calls" }));

    expect(await screen.findByText("Older call")).toBeInTheDocument();
    expect(screen.getByText("Dunbar diligence note")).toBeInTheDocument();
    expect(urls).toEqual([`/api/meetings/calls?q=&before=${encodeURIComponent("2026-09-07T14:47:00.000Z")}`]);
    // That was the end: the button goes.
    expect(screen.queryByRole("button", { name: "Load older calls" })).toBeNull();
  });

  it("offers no Load more when the first page was the whole archive", () => {
    render(<CallArchive initial={[call()]} />);
    expect(screen.queryByRole("button", { name: "Load older calls" })).toBeNull();
  });
});

describe("narrowing", () => {
  it("asks the server for a range, from the reader's clock", async () => {
    const urls = mockFetch(async () => ({ body: { calls: [], hasMore: false } }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.click(screen.getByRole("button", { name: "7 days" }));

    await waitFor(() => expect(urls).toHaveLength(1));
    expect(urls[0]).toMatch(/^\/api\/meetings\/calls\?q=&since=\d{4}-/);
    expect(await screen.findByText("No recorded calls in that range.")).toBeInTheDocument();
  });

  it("narrows what is drawn with the chips, without asking the server", async () => {
    const urls = mockFetch(async () => ({ body: {} }));
    render(
      <CallArchive
        initial={[call(), call({ id: "c2", title: "Unsummarised", summary: "" })]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Has summary" }));

    expect(screen.queryByText("Unsummarised")).toBeNull();
    expect(screen.getByText("Dunbar diligence note")).toBeInTheDocument();
    await settleDebounce();
    expect(urls).toEqual([]);
  });
});

describe("a failed read", () => {
  it("keeps the list on screen and says the calls could not be loaded", async () => {
    mockFetch(async () => ({ ok: false, body: { error: "boom" } }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.click(screen.getByRole("button", { name: "7 days" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.getByText("Dunbar diligence note")).toBeInTheDocument();
    expect(screen.queryByText("No recorded calls in that range.")).toBeNull();
  });
});

describe("a row's own actions", () => {
  it("plays the recording in place, one at a time", async () => {
    render(
      <CallArchive
        initial={[call({ recordingId: "r1" }), call({ id: "c2", title: "Second", recordingId: "r2" })]}
      />,
    );
    expect(document.querySelector("audio")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Play Dunbar diligence note" }));
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("/api/meetings/c1/recording/r1/stream");

    await userEvent.click(screen.getByRole("button", { name: "Play Second" }));
    const players = document.querySelectorAll("audio");
    expect(players).toHaveLength(1);
    expect(players[0].getAttribute("src")).toBe("/api/meetings/c2/recording/r2/stream");

    await userEvent.click(screen.getByRole("button", { name: "Stop playing Second" }));
    expect(document.querySelector("audio")).toBeNull();
  });

  it("has no play button when nothing was kept", () => {
    render(<CallArchive initial={[call({ recordingId: null })]} />);
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });

  it("renames a call once the server agrees", async () => {
    const urls = mockFetch(async () => ({ body: { id: "c1", title: "Dunbar follow-up" } }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.click(screen.getByRole("button", { name: "More actions for Dunbar diligence note" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const field = screen.getByRole("textbox", { name: "Call name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Dunbar follow-up{Enter}");

    expect(await screen.findByText("Dunbar follow-up")).toBeInTheDocument();
    expect(urls).toEqual(["/api/meetings/calls/c1"]);
    expect(screen.queryByRole("textbox", { name: "Call name" })).toBeNull();
  });

  it("keeps the field open, with what was typed, when the rename fails", async () => {
    mockFetch(async () => ({ ok: false, body: {} }));
    render(<CallArchive initial={[call()]} />);

    await userEvent.click(screen.getByRole("button", { name: "More actions for Dunbar diligence note" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Rename/ }));
    const field = screen.getByRole("textbox", { name: "Call name" });
    await userEvent.clear(field);
    await userEvent.type(field, "New name{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(screen.getByRole("textbox", { name: "Call name" })).toHaveValue("New name");
  });

  it("copies the report's link and says so", async () => {
    render(<CallArchive initial={[call()]} />);
    await userEvent.click(screen.getByRole("button", { name: "More actions for Dunbar diligence note" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Copy link/ }));

    expect(copyTextMock).toHaveBeenCalledWith(`${window.location.origin}/meetings/dun-bar-42/report`);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("offers the download only when there is a recording", async () => {
    render(<CallArchive initial={[call({ recordingId: "r1" }), call({ id: "c2", title: "Second", recordingId: null })]} />);
    await userEvent.click(screen.getByRole("button", { name: "More actions for Dunbar diligence note" }));
    expect(screen.getByRole("menuitem", { name: /Download recording/ })).toHaveAttribute(
      "href",
      "/api/meetings/c1/recording/r1/stream?download=1",
    );
    await userEvent.click(screen.getByRole("button", { name: "More actions for Second" }));
    expect(screen.queryByRole("menuitem", { name: /Download recording/ })).toBeNull();
  });
});

describe("the header", () => {
  it("says how much was recorded lately", () => {
    render(<CallArchive initial={[call()]} stats={{ count: 3, seconds: 5400, days: 30 }} />);
    expect(screen.getByText("Last 30 days: 3 calls · 1h 30m recorded")).toBeInTheDocument();
  });

  it("says nothing when nothing was", () => {
    render(<CallArchive initial={[]} stats={{ count: 0, seconds: 0, days: 30 }} />);
    expect(screen.queryByText(/Last 30 days/)).toBeNull();
  });
});

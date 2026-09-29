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

    await userEvent.click(screen.getByRole("button", { name: /Delete Dunbar diligence note/ }));
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

    await userEvent.click(screen.getByRole("button", { name: /Delete Dunbar diligence note/ }));
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be deleted");
    expect(screen.getByText("Dunbar diligence note")).toBeInTheDocument();
  });
});

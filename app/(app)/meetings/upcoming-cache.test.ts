import { fetchUpcoming, forgetUpcoming, recentUpcoming, resetUpcomingCache, UPCOMING_FRESH_MS } from "./upcoming-cache";
import type { UpcomingMeeting } from "./UpcomingMeetingsList";

const row = (id: string) => ({ id }) as unknown as UpcomingMeeting;

describe("upcoming-cache", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    resetUpcomingCache();
    jest.useRealTimers();
  });

  it("shares one request between copies that refresh at the same time", async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      return { ok: true, json: async () => ({ data: [row("a")] }) } as Response;
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([fetchUpcoming(), fetchUpcoming()]);

    expect(calls).toBe(1);
    expect(a).toEqual([row("a")]);
    expect(b).toBe(a);
  });

  function okFetch(ids: string[]) {
    global.fetch = jest.fn(async () =>
      ({ ok: true, json: async () => ({ data: ids.map(row) }) }) as Response,
    ) as unknown as typeof fetch;
  }

  it("hands a copy mounting seconds later the last answer", async () => {
    okFetch(["s"]);
    await fetchUpcoming();
    expect(recentUpcoming()).toEqual([row("s")]);
  });

  it("stops trusting an answer once it is old", async () => {
    okFetch(["s"]);
    await fetchUpcoming();
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + UPCOMING_FRESH_MS + 1);
    expect(recentUpcoming()).toBeNull();
  });

  it("forgets the answer after a local change", async () => {
    okFetch(["s"]);
    await fetchUpcoming();
    forgetUpcoming();
    expect(recentUpcoming()).toBeNull();
  });

  it("returns null on a failed request, so the list keeps what it has", async () => {
    global.fetch = jest.fn(async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    expect(await fetchUpcoming()).toBeNull();
    expect(recentUpcoming()).toBeNull();
  });
});

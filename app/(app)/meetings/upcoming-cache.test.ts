import { fetchUpcoming, recentUpcoming, resetUpcomingCache, seedUpcoming, UPCOMING_FRESH_MS } from "./upcoming-cache";
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

  it("hands a copy mounting soon after the server's answer that answer", () => {
    seedUpcoming([row("s")]);
    expect(recentUpcoming()).toEqual([row("s")]);
  });

  it("stops trusting an answer once it is old", () => {
    jest.useFakeTimers();
    seedUpcoming([row("s")]);
    jest.advanceTimersByTime(UPCOMING_FRESH_MS + 1);
    expect(recentUpcoming()).toBeNull();
  });

  it("returns null on a failed request, so the list keeps what it has", async () => {
    global.fetch = jest.fn(async () => ({ ok: false }) as Response) as unknown as typeof fetch;
    expect(await fetchUpcoming()).toBeNull();
    expect(recentUpcoming()).toBeNull();
  });
});

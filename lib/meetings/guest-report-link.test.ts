/**
 * The thank-you screen's one request: the key goes in the body, a good answer
 * is the link and whether it is ready, and every failure is a quiet null —
 * this runs on the screen that shows a guest out, and nothing there may turn
 * into an error they cannot act on.
 */
import { guestReportLinkPath, requestGuestReportLink } from "./guest-report-link";

const ok = (body: unknown) => async () => ({ ok: true, json: async () => body });

it("posts the key in the body to the room's public route", async () => {
  const calls: Array<[string, RequestInit]> = [];
  const fetchImpl = async (input: string, init: RequestInit) => {
    calls.push([input, init]);
    return { ok: true, json: async () => ({ url: "https://app.test/r/report/tok", ready: true }) };
  };
  const link = await requestGuestReportLink("abc def", "key-1", fetchImpl);
  expect(link).toEqual({ url: "https://app.test/r/report/tok", ready: true });
  expect(calls[0][0]).toBe(guestReportLinkPath("abc def"));
  expect(calls[0][0]).toBe("/api/meetings/public/abc%20def/report-link");
  expect(calls[0][1].method).toBe("POST");
  expect(JSON.parse(String(calls[0][1].body))).toEqual({ guestKey: "key-1" });
  // Never in the URL: a key in a URL is a key in every proxy log.
  expect(calls[0][0]).not.toContain("key-1");
});

it("reports a link that is not ready as such, rather than as missing", async () => {
  const link = await requestGuestReportLink("abc", "key-1", ok({ url: "https://x/r/report/t", ready: false }));
  expect(link).toEqual({ url: "https://x/r/report/t", ready: false });
});

it("is null for a refusal, a bad answer, a thrown fetch, or nothing to ask with", async () => {
  expect(await requestGuestReportLink("abc", "key-1", async () => ({ ok: false, json: async () => ({ error: "no" }) }))).toBeNull();
  expect(await requestGuestReportLink("abc", "key-1", ok({ ready: true }))).toBeNull();
  expect(await requestGuestReportLink("abc", "key-1", async () => { throw new Error("offline"); })).toBeNull();
  const never = jest.fn();
  expect(await requestGuestReportLink("", "key-1", never)).toBeNull();
  expect(await requestGuestReportLink("abc", "  ", never)).toBeNull();
  expect(never).not.toHaveBeenCalled();
});

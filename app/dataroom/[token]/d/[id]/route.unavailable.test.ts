/**
 * "We couldn't check" is not "you may not have this". A reader whose link is
 * good must not be redirected in a circle, or told the file does not exist,
 * during an outage.
 */
jest.mock("server-only", () => ({}), { virtual: true });
let access: unknown = { ok: false };
jest.mock("@/lib/data-room-access.server", () => ({
  resolveSharedDocument: async () => access,
  watermarkLabel: () => "",
}));
jest.mock("@/lib/document-storage.server", () => ({ signDocumentUrl: async () => null }));
jest.mock("@/lib/pdf-watermark.server", () => ({ MAX_WATERMARK_BYTES: 1, watermarkPdf: async () => new Uint8Array() }));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ ok: true, remaining: 1, resetAt: 0, retryAfter: 0 }),
  clientIp: () => "1.2.3.4",
  rateLimitHeaders: () => ({}),
}));
jest.mock("@/lib/data-room-access.server", () => ({
  resolveSharedDocument: async () => access,
  watermarkLabel: () => "",
}));

import { GET as openRoute } from "./route";
import { GET as previewRoute } from "./preview/route";

jest.mock("@/lib/document-text.server", () => ({ getDocumentText: async () => null }));

const ID = "00000000-0000-4000-8000-0000000000a1";
const req = (path: string) => new Request(`http://localhost/dataroom/tok/d/${ID}${path}`);
const params = { params: Promise.resolve({ token: "tok", id: ID }) };

describe("the file route", () => {
  it("answers 503, not a redirect, when access could not be checked", async () => {
    access = { ok: false, unavailable: true };
    const res = await openRoute(req(""), params);
    expect(res.status).toBe(503);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("still sends a denied reader back to the room", async () => {
    access = { ok: false };
    const res = await openRoute(req(""), params);
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toContain("/dataroom/tok");
  });
});

describe("the preview route", () => {
  it("answers 503 when access could not be checked, and 404 when it was denied", async () => {
    access = { ok: false, unavailable: true };
    expect((await previewRoute(req("/preview"), params)).status).toBe(503);
    access = { ok: false };
    expect((await previewRoute(req("/preview"), params)).status).toBe(404);
  });
});

/** @jest-environment node */
import { MAX_REPORT_BYTES } from "@/lib/csp-report";

const report = { "csp-report": { "document-uri": "https://app.test/lp/SECRET", "effective-directive": "script-src-elem", "blocked-uri": "inline", "line-number": 1, "column-number": 2, disposition: "report" } };
let POST: (r: Request) => Promise<Response>;
const post = (body: string, headers: Record<string, string> = {}) => POST(new Request("https://app.test/api/csp-report", { method: "POST", body, headers }));

let warn: jest.SpyInstance;
beforeEach(async () => {
  // A fresh module each time: the log limit is per server instance, and so per module.
  jest.resetModules();
  ({ POST } = await import("./route"));
  warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("POST /api/csp-report", () => {
  it("answers 204 and logs a reduced line", async () => {
    const res = await post(JSON.stringify(report), { "content-type": "application/csp-report" });
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledWith("[csp-report]", { directive: "script-src-elem", blocked: "inline", disposition: "report", line: 1, column: 2 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET");
  });

  it("answers 204 and logs nothing for anything it cannot use", async () => {
    for (const body of ["", "not json", "{}", "[]", "null", JSON.stringify({ "csp-report": { "effective-directive": "<x>" } })]) {
      expect((await post(body)).status).toBe(204);
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("ignores a large body without parsing it, by its declared length or its actual length", async () => {
    expect((await post(JSON.stringify(report), { "content-length": String(MAX_REPORT_BYTES + 1) })).status).toBe(204);
    expect((await post(JSON.stringify({ ...report, pad: "x".repeat(MAX_REPORT_BYTES) }))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("enforces the limit on the bytes received: a streamed body with no declared length, and multibyte text whose length is under the limit", async () => {
    const enc = new TextEncoder();
    let pulled = 0;
    const big = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled += 1;
        c.enqueue(enc.encode("x".repeat(1024)));
        if (pulled > 5000) c.close();
      },
    });
    const res = await POST(new Request("https://app.test/api/csp-report", { method: "POST", body: big, duplex: "half" } as RequestInit));
    expect(res.status).toBe(204);
    expect(pulled).toBeLessThan(50); // stopped at the limit, did not read to the end
    // valid JSON, under the limit in characters, over it in bytes: not parsed, not logged
    const euros = JSON.stringify({ ...report, pad: "€".repeat(MAX_REPORT_BYTES / 2) });
    expect(euros.length).toBeLessThan(MAX_REPORT_BYTES);
    expect((await post(euros)).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("logs at most 60 lines a minute per instance", async () => {
    for (let i = 0; i < 100; i++) await post(JSON.stringify(report));
    expect(warn).toHaveBeenCalledTimes(60);
  });
});

describe("the route file", () => {
  it("exports only what Next.js allows a route file to export (anything else fails the production build)", async () => {
    const mod = await import("./route");
    expect(Object.keys(mod).sort()).toEqual(["POST", "dynamic"]);
  });
});

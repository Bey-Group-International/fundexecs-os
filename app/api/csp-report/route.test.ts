/** @jest-environment node */
import { MAX_REPORT_BYTES } from "@/lib/csp-report";
import { POST, resetCspReportLimit } from "./route";

const report = { "csp-report": { "document-uri": "https://app.test/lp/SECRET", "effective-directive": "script-src-elem", "blocked-uri": "inline", "line-number": 1, "column-number": 2, disposition: "report" } };
const post = (body: string, headers: Record<string, string> = {}) => POST(new Request("https://app.test/api/csp-report", { method: "POST", body, headers }));

let warn: jest.SpyInstance;
beforeEach(() => {
  resetCspReportLimit();
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

  it("logs at most 60 lines a minute per instance", async () => {
    for (let i = 0; i < 100; i++) await post(JSON.stringify(report));
    expect(warn).toHaveBeenCalledTimes(60);
  });
});

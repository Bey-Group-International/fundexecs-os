/** @jest-environment node */
import { createLogLimiter, MAX_VIOLATIONS_PER_REPORT, readCappedBody, summarizeCspReport } from "./csp-report";

const legacy = (over: Record<string, unknown> = {}) => ({
  "csp-report": {
    "document-uri": "https://app.test/lp/SECRET-TOKEN-VALUE",
    "effective-directive": "script-src-elem",
    "blocked-uri": "inline",
    "source-file": "https://app.test/lp/SECRET-TOKEN-VALUE",
    "script-sample": "self.__next_f.push([1,\"{\\\"lpName\\\":\\\"Jane Doe\\\"}\"])",
    "line-number": 12,
    "column-number": 340,
    disposition: "report",
    ...over,
  },
});

describe("summarizeCspReport", () => {
  it("keeps the directive, what kind of thing was blocked, the disposition and the position, and nothing else", () => {
    expect(summarizeCspReport(legacy())).toEqual([{ directive: "script-src-elem", blocked: "inline", disposition: "report", line: 12, column: 340 }]);
  });

  it("never carries the page URL, the source file or the script text, which can hold the bearer link or an LP's data", () => {
    const out = JSON.stringify(summarizeCspReport(legacy()));
    expect(out).not.toMatch(/SECRET|Jane|lpName|document|source|sample|__next_f/);
  });

  it("reduces a blocked URL to its origin: its path and query can hold a token", () => {
    expect(summarizeCspReport(legacy({ "blocked-uri": "https://cdn.evil.example/x.js?token=abc#frag" }))[0].blocked).toBe("https://cdn.evil.example");
    expect(summarizeCspReport(legacy({ "blocked-uri": "data:image/png;base64,AAAA" }))[0].blocked).toBe("data");
    expect(summarizeCspReport(legacy({ "blocked-uri": "blob:https://app.test/uuid" }))[0].blocked).toBe("blob");
    expect(summarizeCspReport(legacy({ "blocked-uri": "eval" }))[0].blocked).toBe("eval");
    expect(summarizeCspReport(legacy({ "blocked-uri": "javascript:alert(1)" }))[0].blocked).toBe("other");
    expect(summarizeCspReport(legacy({ "blocked-uri": "not a url" }))[0].blocked).toBe("other");
    expect(summarizeCspReport(legacy({ "blocked-uri": 5 }))[0].blocked).toBe("other");
  });

  it("reads the Reporting API's format too", () => {
    const out = summarizeCspReport([
      { type: "csp-violation", url: "https://app.test/lp/SECRET", body: { effectiveDirective: "script-src", blockedURL: "inline", disposition: "enforce", lineNumber: 3, columnNumber: 9 } },
      { type: "deprecation", body: { effectiveDirective: "script-src" } },
    ]);
    expect(out).toEqual([{ directive: "script-src", blocked: "inline", disposition: "enforce", line: 3, column: 9 }]);
  });

  it("drops a report whose directive is not a plain directive name, so a hostile one cannot shape a log line", () => {
    expect(summarizeCspReport(legacy({ "effective-directive": "script-src\n[csp-report] forged" }))).toHaveLength(1);
    expect(summarizeCspReport(legacy({ "effective-directive": "<script>" }))).toEqual([]);
    expect(summarizeCspReport(legacy({ "effective-directive": "" }))).toEqual([]);
    expect(summarizeCspReport(legacy({ "effective-directive": "x".repeat(200) }))).toEqual([]);
  });

  it("takes only the first word of a violated directive and nulls positions that are not whole numbers", () => {
    const out = summarizeCspReport(legacy({ "effective-directive": undefined, "violated-directive": "script-src 'self' 'unsafe-inline'", "line-number": -4, "column-number": "7" }));
    expect(out).toEqual([{ directive: "script-src", blocked: "inline", disposition: "report", line: null, column: null }]);
  });

  it("caps what one report can add", () => {
    const many = Array.from({ length: 50 }, () => ({ type: "csp-violation", body: { effectiveDirective: "script-src", blockedURL: "inline" } }));
    expect(summarizeCspReport(many)).toHaveLength(MAX_VIOLATIONS_PER_REPORT);
  });

  it("returns nothing for anything it does not recognise", () => {
    for (const v of [null, undefined, 3, "x", [], {}, [{}], { "csp-report": "x" }, { "csp-report": null }]) expect(summarizeCspReport(v)).toEqual([]);
  });
});

describe("createLogLimiter", () => {
  it("allows a fixed number per window and starts again when the window ends", () => {
    const l = createLogLimiter(3, 1000);
    expect([l.allow(0), l.allow(1), l.allow(2), l.allow(3)]).toEqual([true, true, true, false]);
    expect(l.allow(999)).toBe(false);
    expect([l.allow(1000), l.allow(1001), l.allow(1002), l.allow(1003)]).toEqual([true, true, true, false]);
  });
});

describe("readCappedBody", () => {
  const enc = new TextEncoder();
  const req = (body: BodyInit | null) => new Request("https://app.test/x", { method: "POST", body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit);
  /** A stream of the given chunks that records how many were pulled and whether it was cancelled. */
  const stream = (chunks: Uint8Array[]) => {
    const seen = { pulled: 0, cancelled: false };
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= chunks.length) return controller.close();
        seen.pulled += 1;
        controller.enqueue(chunks[i++]);
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    return { body, seen };
  };

  it("returns the text of a body within the limit, however it is chunked", async () => {
    expect(await readCappedBody(req('{"a":1}'), 100)).toBe('{"a":1}');
    const { body } = stream([enc.encode('{"a"'), enc.encode(":1}")]);
    expect(await readCappedBody(req(body), 100)).toBe('{"a":1}');
  });

  it("accepts a body of exactly the limit and refuses one byte more", async () => {
    expect(await readCappedBody(req("x".repeat(10)), 10)).toBe("x".repeat(10));
    expect(await readCappedBody(req("x".repeat(11)), 10)).toBeNull();
  });

  it("counts bytes, not characters: multibyte text over the limit in bytes is refused although its length is under it", async () => {
    const euros = "€".repeat(4000); // 4000 characters, 12000 bytes
    expect(euros.length).toBeLessThan(8 * 1024);
    expect(await readCappedBody(req(euros), 8 * 1024)).toBeNull();
    expect(await readCappedBody(req("€".repeat(2000)), 8 * 1024)).toBe("€".repeat(2000));
  });

  it("decodes a multibyte character split across chunks", async () => {
    const bytes = enc.encode("a€b");
    const { body } = stream([bytes.slice(0, 2), bytes.slice(2)]);
    expect(await readCappedBody(req(body), 100)).toBe("a€b");
  });

  it("stops reading and cancels the stream as soon as the limit is passed, whatever the request declared", async () => {
    const chunks = Array.from({ length: 1000 }, () => enc.encode("x".repeat(100)));
    const { body, seen } = stream(chunks);
    expect(await readCappedBody(req(body), 250)).toBeNull();
    expect(seen.cancelled).toBe(true);
    // 250 bytes allows two chunks, the third crosses the limit; nothing like all 1000 is read.
    expect(seen.pulled).toBeLessThan(10);
  });

  it("reads a request with no body, or an empty one, as empty text", async () => {
    expect(await readCappedBody(new Request("https://app.test/x", { method: "POST" }), 10)).toBe("");
    expect(await readCappedBody(req(""), 10)).toBe("");
  });
});

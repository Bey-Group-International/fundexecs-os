// lib/digest-tracking.test.ts
// Unit tests for the PURE signed digest-tracking link layer — the implicit half
// of the Radar learning loop. No DB, no network; just HMAC signing/verification,
// URL building/parsing, and the same-origin redirect guard.
import {
  buildTrackingUrl,
  signTrackParams,
  verifyTrackToken,
  parseTrackQuery,
  canonicalTrackString,
  isSafeInternalHref,
  type DigestTrackParams,
} from "@/lib/digest-tracking";

const SECRET = "test-secret-do-not-use";

const clickParams = (over: Partial<DigestTrackParams> = {}): DigestTrackParams => ({
  digestLogId: "log-123",
  orgId: "org-abc",
  entityId: "ent-1",
  entityKind: "company",
  moveKind: "buyers",
  action: "clicked",
  href: "/source/buyers?q=acme",
  ...over,
});

describe("canonicalTrackString", () => {
  it("is positional and stable regardless of object key order", () => {
    const a = canonicalTrackString(clickParams());
    const b = canonicalTrackString({
      action: "clicked",
      href: "/source/buyers?q=acme",
      orgId: "org-abc",
      digestLogId: "log-123",
      moveKind: "buyers",
      entityKind: "company",
      entityId: "ent-1",
    });
    expect(a).toBe(b);
  });

  it("distinguishes empty optionals unambiguously", () => {
    const withHref = canonicalTrackString(clickParams({ href: "/x" }));
    const noHref = canonicalTrackString(clickParams({ href: null }));
    expect(withHref).not.toBe(noHref);
  });
});

describe("sign / verify round-trip", () => {
  it("verifies a freshly-signed token", () => {
    const params = clickParams();
    const token = signTrackParams(SECRET, params);
    expect(verifyTrackToken(SECRET, params, token)).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const params = clickParams();
    const token = signTrackParams("other-secret", params);
    expect(verifyTrackToken(SECRET, params, token)).toBe(false);
  });

  it("rejects when any signed param is tampered", () => {
    const params = clickParams();
    const token = signTrackParams(SECRET, params);
    expect(verifyTrackToken(SECRET, { ...params, href: "/evil" }, token)).toBe(false);
    expect(verifyTrackToken(SECRET, { ...params, orgId: "org-other" }, token)).toBe(false);
    expect(verifyTrackToken(SECRET, { ...params, action: "opened" }, token)).toBe(false);
  });

  it("rejects empty / malformed tokens without throwing", () => {
    const params = clickParams();
    expect(verifyTrackToken(SECRET, params, "")).toBe(false);
    expect(verifyTrackToken(SECRET, params, null)).toBe(false);
    expect(verifyTrackToken(SECRET, params, "deadbeef")).toBe(false);
    expect(verifyTrackToken(SECRET, params, "zzzz")).toBe(false);
  });

  it("round-trips through buildTrackingUrl → parseTrackQuery → verify", () => {
    const params = clickParams();
    const url = buildTrackingUrl(SECRET, params, "https://app.example.com");
    const parsed = parseTrackQuery(new URL(url).searchParams);
    expect(parsed.params.digestLogId).toBe(params.digestLogId);
    expect(parsed.params.orgId).toBe(params.orgId);
    expect(parsed.params.href).toBe(params.href);
    expect(parsed.params.action).toBe("clicked");
    expect(verifyTrackToken(SECRET, parsed.params, parsed.token)).toBe(true);
  });
});

describe("buildTrackingUrl", () => {
  it("targets the track endpoint and carries a token", () => {
    const url = buildTrackingUrl(SECRET, clickParams(), "https://app.example.com");
    expect(url.startsWith("https://app.example.com/api/digest/track?")).toBe(true);
    expect(new URL(url).searchParams.get("t")).toBeTruthy();
  });

  it("returns a relative path when no baseUrl is given", () => {
    const url = buildTrackingUrl(SECRET, clickParams());
    expect(url.startsWith("/api/digest/track?")).toBe(true);
  });

  it("omits empty optional params (e.g. an open pixel has no href)", () => {
    const url = buildTrackingUrl(SECRET, {
      digestLogId: "log-1",
      orgId: "org-1",
      action: "opened",
    });
    const qs = new URL(url, "https://x.test").searchParams;
    expect(qs.get("href")).toBeNull();
    expect(qs.get("entity_id")).toBeNull();
    expect(qs.get("action")).toBe("opened");
  });
});

describe("isSafeInternalHref (open-redirect guard)", () => {
  it("accepts same-origin relative paths", () => {
    expect(isSafeInternalHref("/source/buyers?q=acme")).toBe(true);
    expect(isSafeInternalHref("/")).toBe(true);
  });

  it("rejects absolute external URLs", () => {
    expect(isSafeInternalHref("https://evil.com")).toBe(false);
    expect(isSafeInternalHref("http://evil.com/path")).toBe(false);
  });

  it("rejects protocol-relative and scheme-smuggling tricks", () => {
    expect(isSafeInternalHref("//evil.com")).toBe(false);
    expect(isSafeInternalHref("/\\evil.com")).toBe(false);
    expect(isSafeInternalHref("/ https://evil.com")).toBe(false);
  });

  it("rejects empty / non-path values", () => {
    expect(isSafeInternalHref(null)).toBe(false);
    expect(isSafeInternalHref(undefined)).toBe(false);
    expect(isSafeInternalHref("")).toBe(false);
    expect(isSafeInternalHref("source/buyers")).toBe(false);
  });
});

// lib/safe-next-path.test.ts
// The post-auth redirect target. Two regressions are pinned here:
//
//   1. Open redirect. `next` is attacker-supplied — it arrives as a query
//      parameter on a page anyone can link to — so anything that escapes the
//      origin turns sign-in into a redirector for phishing.
//   2. The parameter being ignored outright. /login?next=/admin was already
//      being minted by app/admin/layout.tsx while the login surface dropped it
//      and the callback's sanitizer was never reached, so a gated deep link
//      always dumped the operator on /workspace.
import {
  DEFAULT_POST_AUTH_PATH,
  safeNextPathOrNull,
  sanitizeNextPath,
} from "./safe-next-path";

const ORIGIN = "https://fundexecs.com";

describe("sanitizeNextPath", () => {
  it("keeps an ordinary internal path", () => {
    expect(sanitizeNextPath("/admin", ORIGIN)).toBe("/admin");
  });

  it("preserves query and hash so a deep link survives intact", () => {
    expect(sanitizeNextPath("/settings?tab=billing#integrations", ORIGIN)).toBe(
      "/settings?tab=billing#integrations",
    );
  });

  it("keeps the installed-app shortcut targets", () => {
    for (const path of ["/earn?source=pwa-shortcut", "/deals/feed", "/approvals"]) {
      expect(sanitizeNextPath(path, ORIGIN)).toBe(path);
    }
  });

  it.each([
    ["an absolute off-site URL", "https://evil.example.com/steal"],
    ["a protocol-relative URL", "//evil.example.com"],
    ["a backslash-smuggled protocol-relative URL", "/\\evil.example.com"],
    ["a scheme-only value", "javascript:alert(1)"],
    ["a bare relative path", "workspace"],
    ["an empty string", ""],
  ])("refuses %s", (_label, raw) => {
    expect(sanitizeNextPath(raw, ORIGIN)).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it("refuses a null or undefined value", () => {
    expect(sanitizeNextPath(null, ORIGIN)).toBe(DEFAULT_POST_AUTH_PATH);
    expect(sanitizeNextPath(undefined, ORIGIN)).toBe(DEFAULT_POST_AUTH_PATH);
  });

  it("honors an explicit fallback", () => {
    expect(sanitizeNextPath("//evil.example.com", ORIGIN, "/home")).toBe("/home");
  });

  it("compares origins, not string prefixes", () => {
    // A host that merely starts with ours is a different origin.
    expect(sanitizeNextPath("/ok", "https://fundexecs.com")).toBe("/ok");
    expect(sanitizeNextPath("https://fundexecs.com.evil.test/x", ORIGIN)).toBe(
      DEFAULT_POST_AUTH_PATH,
    );
  });
});

describe("safeNextPathOrNull", () => {
  it("returns the path when one was legitimately asked for", () => {
    expect(safeNextPathOrNull("/admin", ORIGIN)).toBe("/admin");
  });

  it("distinguishes 'nothing asked for' from the default destination", () => {
    // The caller omits the parameter entirely rather than pinning /workspace
    // into the callback URL, so the callback keeps its own default.
    expect(safeNextPathOrNull(null, ORIGIN)).toBeNull();
    expect(safeNextPathOrNull("https://evil.example.com", ORIGIN)).toBeNull();
  });

  it("still returns a path that happens to equal the default", () => {
    expect(safeNextPathOrNull(DEFAULT_POST_AUTH_PATH, ORIGIN)).toBe(DEFAULT_POST_AUTH_PATH);
  });
});

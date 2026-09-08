// lib/oauth-outcome.test.ts
// The regression: the OAuth connect routes diagnosed every failure precisely
// and reported it on the query string, and both destination pages threw it
// away — Settings took no searchParams at all, /meetings never looked. Consent
// declined, vault key missing, token exchange refused, and outright success all
// rendered as the same unchanged page.
//
// The first test is the one that matters long-term: it reads the route files
// and asserts every code they can actually emit has copy here. A new failure
// path added to a route fails this test instead of silently regressing to the
// behavior above.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { OAUTH_PROVIDERS, readOAuthOutcome } from "./oauth-outcome";

const OAUTH_ROUTES_DIR = path.join(__dirname, "..", "app", "api", "oauth");

/** Every route.ts under app/api/oauth, recursively. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

/**
 * The outcome codes a route hands to its redirect helper.
 *
 * The helpers differ by file (`settingsRedirect`, `back`), so match the shape
 * they share: a call passing `base` and a bare string literal.
 */
function emittedCodes(source: string): string[] {
  const codes = new Set<string>();
  for (const m of source.matchAll(/\b\w+\(\s*base\s*,\s*"([a-z_]+)"\s*\)/g)) {
    codes.add(m[1]);
  }
  return [...codes];
}

describe("every code the OAuth routes emit has copy", () => {
  const files = routeFiles(OAUTH_ROUTES_DIR);

  it("finds the route files at all", () => {
    // Guards the guard: a moved directory would otherwise make this suite pass
    // vacuously.
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it.each(files.map((f) => [path.relative(OAUTH_ROUTES_DIR, f), f]))(
    "%s",
    (_label, file) => {
      const codes = emittedCodes(readFileSync(file, "utf8"));
      expect(codes.length).toBeGreaterThan(0);
      for (const code of codes) {
        const outcome = readOAuthOutcome({ google: code });
        expect(outcome).not.toBeNull();
        // The unknown-code fallback quotes the raw code; real copy never does.
        expect(outcome!.detail).not.toContain(`(${code})`);
      }
    },
  );
});

describe("readOAuthOutcome", () => {
  it("returns null when no provider reported anything", () => {
    expect(readOAuthOutcome({})).toBeNull();
    expect(readOAuthOutcome(undefined)).toBeNull();
    expect(readOAuthOutcome({ tab: "billing" })).toBeNull();
  });

  it("labels each provider by name", () => {
    expect(readOAuthOutcome({ google: "connected" })!.title).toBe("Gmail connected");
    expect(readOAuthOutcome({ google_people: "connected" })!.title).toBe(
      "Google Contacts connected",
    );
    expect(readOAuthOutcome({ google_calendar: "connected" })!.title).toBe(
      "Google Calendar connected",
    );
    expect(readOAuthOutcome({ carta: "connected" })!.title).toBe("Carta connected");
  });

  // A connection whose first sync did not finish is not a failure: the grant is
  // saved and the sweep will finish the job. Reporting it as an error would
  // send a member back through consent to fix something that is not broken.
  it("treats a still-syncing calendar as connected, not failed", () => {
    const outcome = readOAuthOutcome({ google_calendar: "connected_syncing" })!;
    expect(outcome.tone).toBe("success");
    expect(outcome.title).toBe("Google Calendar connected");
    expect(outcome.detail).toMatch(/still loading/i);
    // It must not fall through to the unknown-code branch, which would tell the
    // member to quote a support code for a normal outcome.
    expect(outcome.detail).not.toMatch(/unrecognized/i);
  });

  it("marks only success as success", () => {
    expect(readOAuthOutcome({ google: "connected" })!.tone).toBe("success");
    for (const code of ["denied", "exchange_failed", "vault_not_configured", "forbidden"]) {
      expect(readOAuthOutcome({ google: code })!.tone).toBe("error");
    }
  });

  it("surfaces an unrecognized code rather than swallowing it", () => {
    const outcome = readOAuthOutcome({ carta: "brand_new_failure" });
    expect(outcome).not.toBeNull();
    expect(outcome!.tone).toBe("error");
    expect(outcome!.detail).toContain("brand_new_failure");
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(readOAuthOutcome({ google: ["connected", "denied"] })!.code).toBe("connected");
  });

  it("ignores an empty value", () => {
    expect(readOAuthOutcome({ google: "" })).toBeNull();
  });

  it("carries the raw code through for support", () => {
    expect(readOAuthOutcome({ google: "no_refresh_token" })!.code).toBe("no_refresh_token");
  });

  it("covers every provider the routes redirect to", () => {
    expect(Object.keys(OAUTH_PROVIDERS).sort()).toEqual([
      "carta",
      "google",
      "google_calendar",
      "google_people",
    ]);
  });
});

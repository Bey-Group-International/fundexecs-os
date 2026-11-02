/** @jest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";

const { SITE_HEADERS, lpHeaders, lpContentSecurityPolicy, lpNonceReportOnlyPolicy, isLpPath, LP_CSP_REPORT_PATH, securityHeaderRules } = require("./security-headers.cjs") as {
  lpNonceReportOnlyPolicy: (nonce: string, o?: { dev?: boolean }) => string;
  isLpPath: (p: string) => boolean;
  LP_CSP_REPORT_PATH: string;
  SITE_HEADERS: Array<{ key: string; value: string }>;
  lpHeaders: (o?: { dev?: boolean }) => Array<{ key: string; value: string }>;
  lpContentSecurityPolicy: (o?: { dev?: boolean }) => string;
  securityHeaderRules: (o?: { dev?: boolean }) => Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};

const byKey = (h: Array<{ key: string; value: string }>) => Object.fromEntries(h.map((x) => [x.key, x.value]));

describe("the site-wide headers", () => {
  const site = byKey(SITE_HEADERS);

  it("keep the values the app already had", () => {
    expect(site["X-Content-Type-Options"]).toBe("nosniff");
    expect(site["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(site["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(site["Permissions-Policy"]).toBe("camera=(self), microphone=(self), geolocation=()");
  });

  it("add HSTS for a year, for this host only, without preload", () => {
    expect(site["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(site["Strict-Transport-Security"]).not.toMatch(/includeSubDomains|preload/i);
  });

  it("do not impose the investor pages' policy on the rest of the app", () => {
    expect(site["Content-Security-Policy"]).toBeUndefined();
    expect(site["Cache-Control"]).toBeUndefined();
    expect(site["X-Robots-Tag"]).toBeUndefined();
  });
});

describe("the investor pages' headers", () => {
  const lp = byKey(lpHeaders());

  it("never send the link as a Referer, and cannot be framed", () => {
    expect(lp["Referrer-Policy"]).toBe("no-referrer");
    expect(lp["X-Frame-Options"]).toBe("DENY");
  });

  it("are neither cached nor indexed", () => {
    expect(lp["Cache-Control"]).toMatch(/no-store/);
    expect(lp["X-Robots-Tag"]).toMatch(/noindex/);
  });

  it("turn off the camera, microphone and location", () => {
    expect(lp["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("override every site-wide header they share a name with, and only add the rest", () => {
    const site = byKey(SITE_HEADERS);
    const shared = Object.keys(lp).filter((k) => k in site);
    expect(shared.sort()).toEqual(["Permissions-Policy", "Referrer-Policy", "X-Frame-Options"]);
  });
});

describe("the investor pages' Content-Security-Policy", () => {
  const directives = (csp: string): Record<string, string[]> =>
    Object.fromEntries(
      csp
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .map(([n, ...v]) => [n, v]),
    );
  const prod = directives(lpContentSecurityPolicy());

  it("forbids framing and plugins, and keeps the base URL and form targets to this origin", () => {
    expect(prod["frame-ancestors"]).toEqual(["'none'"]);
    expect(prod["object-src"]).toEqual(["'none'"]);
    expect(prod["base-uri"]).toEqual(["'self'"]);
    expect(prod["form-action"]).toEqual(["'self'"]);
  });

  it("allows nothing from another origin: no wildcard, no scheme, no host", () => {
    for (const [name, values] of Object.entries(prod)) {
      for (const v of values) {
        expect(`${name} ${v}`).not.toMatch(/\*|https?:|wss?:|\.[a-z]{2,}\b/i);
      }
    }
    expect(prod["default-src"]).toEqual(["'self'"]);
    expect(prod["connect-src"]).toEqual(["'self'"]);
  });

  it("allows inline script and style, which Next.js needs, and says what that costs", () => {
    expect(prod["script-src"]).toContain("'unsafe-inline'");
    expect(prod["style-src"]).toContain("'unsafe-inline'");
    const src = readFileSync(path.join(__dirname, "security-headers.cjs"), "utf8");
    expect(src).toMatch(/not a defence against injected inline script/);
  });

  it("allows eval in development only", () => {
    expect(prod["script-src"]).not.toContain("'unsafe-eval'");
    expect(directives(lpContentSecurityPolicy({ dev: true }))["script-src"]).toContain("'unsafe-eval'");
    expect(JSON.stringify(securityHeaderRules({ dev: false }))).not.toContain("unsafe-eval");
  });
});

describe("the nonce policy sent report-only (SOC 2 G-4)", () => {
  const directives = (csp: string): Record<string, string[]> =>
    Object.fromEntries(
      csp
        .split(";")
        .map((d) => d.trim().split(/\s+/))
        .map(([n, ...v]) => [n, v]),
    );
  const enforced = directives(lpContentSecurityPolicy());
  const reportOnly = directives(lpNonceReportOnlyPolicy("N0nce"));

  it("replaces unsafe-inline in script-src with this request's nonce and strict-dynamic", () => {
    expect(reportOnly["script-src"]).toEqual(["'self'", "'nonce-N0nce'", "'strict-dynamic'"]);
    expect(reportOnly["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("differs from the enforced policy in nothing else but where it reports", () => {
    const { "script-src": _a, ...restEnforced } = enforced;
    const { "script-src": _b, "report-uri": reportUri, ...restReportOnly } = reportOnly;
    expect(restReportOnly).toEqual(restEnforced);
    expect(reportUri).toEqual([LP_CSP_REPORT_PATH]);
  });

  it("reports to this site only, and keeps eval to development", () => {
    expect(LP_CSP_REPORT_PATH).toBe("/api/csp-report");
    expect(lpNonceReportOnlyPolicy("n")).not.toContain("unsafe-eval");
    expect(directives(lpNonceReportOnlyPolicy("n", { dev: true }))["script-src"]).toContain("'unsafe-eval'");
  });

  it("leaves the enforced policy exactly as it was", () => {
    expect(lpContentSecurityPolicy()).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  it("applies to the investor pages and nothing that merely starts with /lp", () => {
    expect(isLpPath("/lp")).toBe(true);
    expect(isLpPath("/lp/abc")).toBe(true);
    for (const p of ["/lpx", "/lpx/abc", "/", "/api/lp/abc", "/run/lp"]) expect(isLpPath(p)).toBe(false);
  });
});

describe("securityHeaderRules", () => {
  const rules = securityHeaderRules();

  it("applies the site-wide set to everything, then the investor set to /lp/", () => {
    expect(rules.map((r) => r.source)).toEqual(["/(.*)", "/lp/:path*"]);
  });

  it("declares the investor rule after the site-wide one, so it is the later match for a shared key", () => {
    expect(rules.findIndex((r) => r.source === "/lp/:path*")).toBeGreaterThan(rules.findIndex((r) => r.source === "/(.*)"));
  });
});

describe("next.config.mjs", () => {
  const config = readFileSync(path.join(__dirname, "..", "next.config.mjs"), "utf8");

  it("takes its security headers from lib/security-headers.cjs, not a second copy", () => {
    expect(config).toMatch(/security-headers\.cjs/);
    expect(config).toMatch(/\.\.\.securityHeaderRules\(/);
    expect(config).not.toMatch(/key:\s*"X-Frame-Options"/);
  });

  it("asks for the development policy outside production only", () => {
    expect(config).toMatch(/dev:\s*process\.env\.NODE_ENV !== "production"/);
  });
});

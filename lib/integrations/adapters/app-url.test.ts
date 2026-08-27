// lib/integrations/adapters/app-url.test.ts
// The base URL every OAuth redirect is built from. The regression these tests
// pin down: a production deploy on the apex domain (or one with no site URL
// configured at all) used to fall back to http://localhost:3000, so clicking
// "Connect" on Settings › Integrations sent the operator to a dead localhost
// tab instead of Google's consent screen.
import { getAppUrl, getAppUrlFromRequest } from "./app-url";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXTAUTH_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

function request(headers: Record<string, string>): Request {
  return new Request("https://example.invalid/api/oauth/google/start", { headers });
}

describe("getAppUrl", () => {
  it("accepts the apex production domain", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fundexecs.com";
    expect(getAppUrl()).toBe("https://fundexecs.com");
  });

  it("accepts subdomains and strips a trailing slash", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.fundexecs.com/";
    expect(getAppUrl()).toBe("https://app.fundexecs.com");
  });

  it("falls through to the Vercel production domain when no site URL is set", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "fundexecs-os.vercel.app";
    expect(getAppUrl()).toBe("https://fundexecs-os.vercel.app");
  });

  it("falls through past an off-platform value rather than collapsing to localhost", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://evil.example.com";
    process.env.VERCEL_URL = "fundexecs-os-abc123.vercel.app";
    expect(getAppUrl()).toBe("https://fundexecs-os-abc123.vercel.app");
  });

  it("refuses an off-platform host with nothing else configured", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://evil.example.com";
    expect(getAppUrl()).toBe("http://localhost:3000");
  });

  it("returns localhost for local development", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    expect(getAppUrl()).toBe("http://localhost:3000");
  });
});

describe("getAppUrlFromRequest", () => {
  it("uses the forwarded host when nothing is configured", () => {
    const url = getAppUrlFromRequest(
      request({ "x-forwarded-host": "fundexecs.com", "x-forwarded-proto": "https" }),
    );
    expect(url).toBe("https://fundexecs.com");
  });

  it("takes the first proto from a forwarded chain", () => {
    const url = getAppUrlFromRequest(
      request({ "x-forwarded-host": "app.fundexecs.com", "x-forwarded-proto": "https,http" }),
    );
    expect(url).toBe("https://app.fundexecs.com");
  });

  it("prefers an explicitly configured canonical URL over the request host", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.fundexecs.com";
    const url = getAppUrlFromRequest(request({ "x-forwarded-host": "preview.vercel.app" }));
    expect(url).toBe("https://app.fundexecs.com");
  });

  it("ignores a spoofed off-platform host header", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "fundexecs-os.vercel.app";
    const url = getAppUrlFromRequest(request({ host: "attacker.example.com" }));
    expect(url).toBe("https://fundexecs-os.vercel.app");
  });

  it("keeps http for a local host header", () => {
    expect(getAppUrlFromRequest(request({ host: "localhost:3000" }))).toBe("http://localhost:3000");
  });

  it("falls back to configuration when the request carries no host", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fundexecs.com";
    expect(getAppUrlFromRequest(new Request("https://x.invalid/"))).toBe("https://fundexecs.com");
  });
});

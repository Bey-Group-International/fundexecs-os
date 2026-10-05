// The canonical origin every emailed link is built on. A value configured as a
// bare host or with stray whitespace used to leak straight into invite links,
// which every email template then refused to render.
import { normalizeSiteUrl, PRODUCTION_SITE_URL, SITE_URL } from "./site";

describe("normalizeSiteUrl", () => {
  it("keeps a well-formed origin as it is", () => {
    expect(normalizeSiteUrl("https://app.fundexecs.com")).toBe("https://app.fundexecs.com");
    expect(normalizeSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("strips trailing slashes and whitespace", () => {
    expect(normalizeSiteUrl("https://app.test/")).toBe("https://app.test");
    expect(normalizeSiteUrl("  https://app.test///  ")).toBe("https://app.test");
  });

  it("adds the scheme a bare host is missing, as Vercel's URL variables are", () => {
    expect(normalizeSiteUrl("fundexecs.com")).toBe("https://fundexecs.com");
    expect(normalizeSiteUrl("my-preview.vercel.app/")).toBe("https://my-preview.vercel.app");
  });

  it("keeps only the origin, never a configured path", () => {
    expect(normalizeSiteUrl("https://app.test/some/path?x=1")).toBe("https://app.test");
  });

  it("falls back to production when nothing usable is configured", () => {
    expect(normalizeSiteUrl(undefined)).toBe(PRODUCTION_SITE_URL);
    expect(normalizeSiteUrl("")).toBe(PRODUCTION_SITE_URL);
    expect(normalizeSiteUrl("   ")).toBe(PRODUCTION_SITE_URL);
    expect(normalizeSiteUrl("http://")).toBe(PRODUCTION_SITE_URL);
    expect(normalizeSiteUrl("not a url at all")).toBe(PRODUCTION_SITE_URL);
  });

  it("is what SITE_URL is built from: always an absolute http(s) origin", () => {
    expect(SITE_URL).toMatch(/^https?:\/\/[^/]+$/);
  });
});

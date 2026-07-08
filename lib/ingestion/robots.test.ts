// lib/ingestion/robots.test.ts
// Unit tests for the robots.txt parser + allow check — the compliance spine.
// Pure: no network, no DB.
import { parseRobots, isAllowed, crawlDelayFor, groupFor } from "@/lib/ingestion/robots";

const UA = "FundExecs-Bot/1.0";

describe("parseRobots + isAllowed", () => {
  it("allows everything when robots is empty", () => {
    const policy = parseRobots("");
    expect(isAllowed(policy, UA, "/anything")).toBe(true);
  });

  it("honors a wildcard Disallow", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /private");
    expect(isAllowed(policy, UA, "/private/x")).toBe(false);
    expect(isAllowed(policy, UA, "/public")).toBe(true);
  });

  it("applies longest-match precedence (Allow overrides a broader Disallow)", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /docs\nAllow: /docs/public");
    expect(isAllowed(policy, UA, "/docs/private")).toBe(false);
    expect(isAllowed(policy, UA, "/docs/public/a")).toBe(true);
  });

  it("prefers a specific user-agent group over the catch-all", () => {
    const policy = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: fundexecs-bot\nDisallow: /admin\nAllow: /",
    );
    // Our bot uses its specific group: only /admin is blocked.
    expect(isAllowed(policy, UA, "/deals")).toBe(true);
    expect(isAllowed(policy, UA, "/admin")).toBe(false);
    // A different agent falls under the catch-all: everything blocked.
    expect(isAllowed(policy, "SomeOtherBot", "/deals")).toBe(false);
  });

  it("treats an empty Disallow as allow-all", () => {
    const policy = parseRobots("User-agent: *\nDisallow:");
    expect(isAllowed(policy, UA, "/whatever")).toBe(true);
  });

  it("supports the $ end-anchor and * wildcard in patterns", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /*.pdf$");
    expect(isAllowed(policy, UA, "/reports/q1.pdf")).toBe(false);
    expect(isAllowed(policy, UA, "/reports/q1.pdf.html")).toBe(true);
  });

  it("ignores comments and blank lines", () => {
    const policy = parseRobots("# comment\n\nUser-agent: *\n  # another\nDisallow: /x\n");
    expect(isAllowed(policy, UA, "/x")).toBe(false);
  });

  it("shares directives across consecutive User-agent lines", () => {
    const policy = parseRobots("User-agent: botA\nUser-agent: botB\nDisallow: /shared");
    expect(isAllowed(policy, "botA", "/shared")).toBe(false);
    expect(isAllowed(policy, "botB", "/shared")).toBe(false);
  });

  it("drops directives that precede any User-agent", () => {
    const policy = parseRobots("Disallow: /orphan\nUser-agent: *\nDisallow: /real");
    expect(isAllowed(policy, UA, "/orphan")).toBe(true);
    expect(isAllowed(policy, UA, "/real")).toBe(false);
  });
});

describe("crawlDelayFor", () => {
  it("reads a numeric crawl-delay for the matching group", () => {
    const policy = parseRobots("User-agent: *\nCrawl-delay: 5");
    expect(crawlDelayFor(policy, UA)).toBe(5);
  });

  it("returns null when none is declared", () => {
    const policy = parseRobots("User-agent: *\nDisallow: /x");
    expect(crawlDelayFor(policy, UA)).toBeNull();
  });
});

describe("groupFor", () => {
  it("falls back to an empty permissive group when no group matches", () => {
    const policy = parseRobots("User-agent: onlybot\nDisallow: /");
    const g = groupFor(policy, UA);
    expect(g.rules).toEqual([]);
  });
});

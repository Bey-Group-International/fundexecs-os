// lib/ingestion/robots.ts
// A minimal, dependency-free robots.txt parser + allow check — the compliance
// spine of the ingestion engine. FundExecs sources deal/LP/company intelligence
// from the public web; doing that responsibly for a regulated financial product
// means we honor robots.txt, identify ourselves, and rate-limit. This is the
// TypeScript distillation of the "respect robots.txt" behavior that Crawlee
// gives you out of the box, kept PURE (no network, no DB) so it is fully
// unit-testable and runs keyless in CI.
//
// Scope is deliberately the widely-supported subset of the spec: grouped
// User-agent stanzas, Allow / Disallow with longest-match-wins precedence, and
// Crawl-delay. We do not implement wildcards beyond the two the spec blesses
// (`*` inside a path and `$` end-anchor), which covers real-world robots files.

// One directive parsed from a group: a path pattern and whether it grants or
// denies. Empty `Disallow:` (allow everything) is normalized to allow "/".
export interface RobotsRule {
  allow: boolean;
  path: string;
}

// The compiled rules for a single user-agent, plus any crawl-delay it declared.
export interface RobotsGroup {
  rules: RobotsRule[];
  crawlDelaySec: number | null;
}

export interface RobotsPolicy {
  // Keyed by lower-cased user-agent token; "*" is the catch-all group.
  groups: Record<string, RobotsGroup>;
}

// Turn a robots.txt path pattern into a matcher. Supports `*` (any run) and a
// trailing `$` (end-anchor), the two wildcards the spec sanctions. Pure.
function patternToRegExp(pattern: string): RegExp {
  let anchored = false;
  let p = pattern;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const escaped = p
    .split("*")
    .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + escaped + (anchored ? "$" : ""));
}

/**
 * Parse a robots.txt body into a policy. Unknown lines and comments are
 * ignored. A directive with no preceding User-agent is dropped (per spec).
 * Pure — no I/O.
 */
export function parseRobots(body: string): RobotsPolicy {
  const groups: Record<string, RobotsGroup> = {};
  // Active agents for the current stanza; consecutive User-agent lines share
  // the directives that follow, so we accumulate until a non-agent directive.
  let activeAgents: string[] = [];
  let sawDirective = false;

  const ensure = (agent: string): RobotsGroup =>
    (groups[agent] ??= { rules: [], crawlDelaySec: null });

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    switch (field) {
      case "user-agent": {
        // A User-agent after we've seen directives starts a fresh stanza.
        if (sawDirective) {
          activeAgents = [];
          sawDirective = false;
        }
        activeAgents.push(value.toLowerCase());
        ensure(value.toLowerCase());
        break;
      }
      case "disallow":
      case "allow": {
        if (activeAgents.length === 0) break;
        sawDirective = true;
        const allow = field === "allow";
        // Empty Disallow means "allow all"; empty Allow is a no-op.
        if (value === "" && !allow) {
          for (const a of activeAgents) ensure(a).rules.push({ allow: true, path: "/" });
          break;
        }
        if (value === "") break;
        for (const a of activeAgents) ensure(a).rules.push({ allow, path: value });
        break;
      }
      case "crawl-delay": {
        if (activeAgents.length === 0) break;
        sawDirective = true;
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) {
          for (const a of activeAgents) ensure(a).crawlDelaySec = n;
        }
        break;
      }
      default:
        break;
    }
  }
  return { groups };
}

// Pick the group that governs a given user-agent: exact token match wins,
// otherwise the "*" catch-all, otherwise a permissive empty group. Robots
// matching is on a case-insensitive substring of the product token; we match
// on the leading token (e.g. "fundexecs-bot/1.0" → "fundexecs-bot"). Pure.
export function groupFor(policy: RobotsPolicy, userAgent: string): RobotsGroup {
  const token = userAgent.toLowerCase().split("/")[0].trim();
  for (const key of Object.keys(policy.groups)) {
    if (key !== "*" && token.includes(key)) return policy.groups[key];
  }
  return policy.groups["*"] ?? { rules: [], crawlDelaySec: null };
}

/**
 * Decide whether `pathname` may be fetched under `policy` for `userAgent`.
 * Longest-matching rule wins; Allow beats Disallow on an exact-length tie
 * (the Google convention). No matching rule → allowed. Pure.
 */
export function isAllowed(policy: RobotsPolicy, userAgent: string, pathname: string): boolean {
  const group = groupFor(policy, userAgent);
  if (group.rules.length === 0) return true;
  const path = pathname || "/";
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of group.rules) {
    if (patternToRegExp(rule.path).test(path)) {
      const len = rule.path.length;
      if (!best || len > best.len || (len === best.len && rule.allow)) {
        best = { allow: rule.allow, len };
      }
    }
  }
  return best ? best.allow : true;
}

// The crawl-delay (seconds) the policy asks this agent to honor, or null. Pure.
export function crawlDelayFor(policy: RobotsPolicy, userAgent: string): number | null {
  return groupFor(policy, userAgent).crawlDelaySec;
}

export const __test = { patternToRegExp };

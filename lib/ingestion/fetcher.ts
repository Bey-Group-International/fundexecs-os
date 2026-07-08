// lib/ingestion/fetcher.ts
// The polite HTTP fetch layer for ingestion. This is the compliance-first
// distillation of what a crawler framework (Crawlee) gives you: identify the
// bot, honor robots.txt, and rate-limit per host. We intentionally ship ONLY
// the compliant fetcher — no headless/anti-detection backend — but keep the
// FetcherStrategy seam open so a different backend can be slotted per-source
// later without touching the pipeline.
//
// Everything here is best-effort and bounded: an AbortController timeout, a
// response-size cap, a per-host politeness delay, and a robots.txt gate the
// caller can inspect. A blocked or failed fetch returns a typed result, never
// throws — the pipeline decides what to do with it.
import { parseRobots, isAllowed, crawlDelayFor, type RobotsPolicy } from "@/lib/ingestion/robots";

export interface FetchResult {
  url: string;
  ok: boolean;
  status: number;
  html: string;
  contentType: string | null;
  /** Why a fetch did not yield usable HTML, when !ok. */
  reason?: "robots" | "http_error" | "not_html" | "too_large" | "network" | "timeout";
}

// The seam. A strategy turns a URL into a FetchResult. The compliant fetcher is
// the only implementation shipped; a stealth/headless one could implement this
// interface behind the same pipeline if a source ever justifies it.
export interface FetcherStrategy {
  fetch(url: string): Promise<FetchResult>;
}

export interface CompliantFetcherOptions {
  /** Identifies the crawler to origin servers and robots.txt. */
  userAgent?: string;
  /** Per-request abort timeout. */
  timeoutMs?: number;
  /** Minimum gap between requests to the SAME host (politeness floor). */
  minDelayMs?: number;
  /** Hard cap on response body we will read into memory. */
  maxBytes?: number;
  /** Injectable fetch — defaults to global fetch; overridable in tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULTS = {
  userAgent: "FundExecs-Bot/1.0 (+https://fundexecs.com/bot)",
  timeoutMs: 15_000,
  minDelayMs: 1_000,
  maxBytes: 2_000_000,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * A robots-respecting, rate-limited HTTP fetcher. Caches each host's robots
 * policy for the fetcher's lifetime and never requests a path robots.txt
 * disallows for our user-agent. Enforces the greater of the configured floor
 * and the host's declared Crawl-delay between same-host requests.
 */
export class CompliantFetcher implements FetcherStrategy {
  private readonly ua: string;
  private readonly timeoutMs: number;
  private readonly minDelayMs: number;
  private readonly maxBytes: number;
  private readonly fetchImpl: typeof fetch;
  private readonly robotsCache = new Map<string, RobotsPolicy | null>();
  private readonly lastFetchAt = new Map<string, number>();

  constructor(opts: CompliantFetcherOptions = {}) {
    this.ua = opts.userAgent ?? DEFAULTS.userAgent;
    this.timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
    this.minDelayMs = opts.minDelayMs ?? DEFAULTS.minDelayMs;
    this.maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // Load + cache the host's robots policy (best-effort). A missing or
  // unreadable robots.txt is treated as "no restrictions" (cached null).
  private async robotsFor(origin: string): Promise<RobotsPolicy | null> {
    if (this.robotsCache.has(origin)) return this.robotsCache.get(origin) ?? null;
    let policy: RobotsPolicy | null = null;
    try {
      const res = await this.timedFetch(`${origin}/robots.txt`);
      if (res.ok) policy = parseRobots(await res.text());
    } catch {
      policy = null;
    }
    this.robotsCache.set(origin, policy);
    return policy;
  }

  // fetch() wrapped in an AbortController timeout. Throws on network/timeout.
  private async timedFetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        signal: controller.signal,
        headers: { "user-agent": this.ua, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // Wait out the politeness gap for this host, honoring Crawl-delay when larger.
  private async throttle(origin: string, policy: RobotsPolicy | null): Promise<void> {
    const declared = policy ? crawlDelayFor(policy, this.ua) : null;
    const floor = Math.max(this.minDelayMs, declared != null ? declared * 1000 : 0);
    const last = this.lastFetchAt.get(origin);
    if (last != null) {
      const wait = floor - (Date.now() - last);
      if (wait > 0) await sleep(wait);
    }
    this.lastFetchAt.set(origin, Date.now());
  }

  async fetch(url: string): Promise<FetchResult> {
    let origin: string;
    let pathname: string;
    try {
      const u = new URL(url);
      origin = u.origin;
      pathname = u.pathname + u.search;
    } catch {
      return { url, ok: false, status: 0, html: "", contentType: null, reason: "network" };
    }

    const policy = await this.robotsFor(origin);
    if (policy && !isAllowed(policy, this.ua, pathname)) {
      return { url, ok: false, status: 0, html: "", contentType: null, reason: "robots" };
    }

    await this.throttle(origin, policy);

    let res: Response;
    try {
      res = await this.timedFetch(url);
    } catch (err) {
      const reason = err instanceof Error && err.name === "AbortError" ? "timeout" : "network";
      return { url, ok: false, status: 0, html: "", contentType: null, reason };
    }

    if (!res.ok) {
      return { url, ok: false, status: res.status, html: "", contentType: null, reason: "http_error" };
    }
    const contentType = res.headers.get("content-type");
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return { url, ok: false, status: res.status, html: "", contentType, reason: "not_html" };
    }
    const declaredLen = Number(res.headers.get("content-length") ?? "0");
    if (declaredLen && declaredLen > this.maxBytes) {
      return { url, ok: false, status: res.status, html: "", contentType, reason: "too_large" };
    }

    const html = await res.text();
    if (html.length > this.maxBytes) {
      return { url, ok: false, status: res.status, html: "", contentType, reason: "too_large" };
    }
    return { url, ok: true, status: res.status, html, contentType };
  }
}

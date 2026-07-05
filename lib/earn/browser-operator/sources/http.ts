// lib/earn/browser-operator/sources/http.ts
//
// A tiny, injectable HTTP layer shared by the browser-FREE extraction sources
// (EDGAR + public web). Everything here is plain server-side `fetch` — NO
// headless browser, NO automation of authenticated sites. Keeping the fetch
// function injectable is what lets the source modules be unit-tested with sample
// payloads and zero network access.

/** The minimal response shape the source modules rely on. `Response` satisfies it. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Request options we ever pass. A subset of `RequestInit`, so real `fetch` fits. */
export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** The injectable fetch contract. The global `fetch` is assignable to this. */
export type HttpFetch = (url: string, init?: HttpRequestInit) => Promise<HttpResponse>;

/** The default, real network fetch. Overridable in every source for testing. */
export const defaultHttpFetch: HttpFetch = (url, init) =>
  fetch(url, init as RequestInit);

/**
 * Fetch a URL with a wall-clock timeout and a hard body-size cap, returning the
 * decoded text (truncated to `maxBytes`). Used by the public-web reader so a
 * hostile or huge page can never hang or blow up memory. Best-effort on runtimes
 * where `AbortController` is unavailable (the injected test fetch ignores it).
 */
export async function fetchTextCapped(
  http: HttpFetch,
  url: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ ok: boolean; status: number; body: string }> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 1_500_000;

  let signal: AbortSignal | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (typeof AbortController === "function") {
    const controller = new AbortController();
    signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    const res = await http(url, { headers: opts.headers, signal });
    const raw = await res.text();
    const body = raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
    return { ok: res.ok, status: res.status, body };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

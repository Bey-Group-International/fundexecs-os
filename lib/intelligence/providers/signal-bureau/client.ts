// lib/intelligence/providers/signal-bureau/client.ts
// The Signal Bureau REST client. Server-only. Owns the resilience the connector
// spec mandates: request timeouts, exponential backoff with jitter, retry-after
// honouring, retry classification, and a bounded attempt count. It returns typed
// wire shapes (schema.ts); the adapter normalizes them. It NEVER throws to the
// provider — a failure is a typed ClientOutcome the provider degrades on.
//
// It holds no state and no secrets: base URL + token are passed in per call, so
// the caller (connections.ts) owns credential decryption and this module stays
// pure-ish and testable.

import type { SbAskResponse, SbSignalsResponse, SbStatsResponse } from "./schema";

export interface ClientConfig {
  baseUrl: string;
  token: string | null;
  /** Per-request timeout (ms). */
  timeoutMs?: number;
  /** Max attempts for a retryable failure (including the first). */
  maxAttempts?: number;
}

export type ClientOutcome<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number; retryable: boolean; rateLimited: boolean };

const DEFAULT_TIMEOUT = 8_000;
const DEFAULT_ATTEMPTS = 3;

/** Retryable: network error, 429, or 5xx. 4xx (except 429) is terminal. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (!Number.isNaN(secs) && secs >= 0) return Math.min(secs * 1000, 30_000);
  }
  const base = Math.min(2 ** attempt * 500, 8_000); // 500ms, 1s, 2s, …
  const jitter = Math.random() * base * 0.25;
  return base + jitter;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(
  cfg: ClientConfig,
  path: string,
  init: RequestInit,
): Promise<ClientOutcome<T>> {
  const url = `${cfg.baseUrl.replace(/\/$/, "")}${path}`;
  const maxAttempts = cfg.maxAttempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT;

  let lastError = "unknown error";
  let lastStatus = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...(init.headers as Record<string, string> | undefined),
      };
      if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;

      const res = await fetch(url, { ...init, headers, signal: controller.signal });
      lastStatus = res.status;

      if (res.ok) {
        const data = (await res.json()) as T;
        return { ok: true, data, status: res.status };
      }

      const retryable = isRetryableStatus(res.status);
      lastError = `HTTP ${res.status}`;
      if (retryable && attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt, res.headers.get("retry-after")));
        continue;
      }
      return {
        ok: false,
        error: lastError,
        status: res.status,
        retryable,
        rateLimited: res.status === 429,
      };
    } catch (e) {
      // Network error or timeout (abort) — retryable.
      lastError = e instanceof Error ? e.message : "network error";
      if (attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      return { ok: false, error: lastError, status: 0, retryable: true, rateLimited: false };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: lastError, status: lastStatus, retryable: true, rateLimited: false };
}

/** GET /api/signals — the scheduled feed. */
export function getSignals(
  cfg: ClientConfig,
  params: { limit?: number; since?: string; entities?: string[] } = {},
): Promise<ClientOutcome<SbSignalsResponse>> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.since) qs.set("since", params.since);
  if (params.entities?.length) qs.set("entities", params.entities.join(","));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return request<SbSignalsResponse>(cfg, `/api/signals${suffix}`, { method: "GET" });
}

/** POST /api/ask — future-event / scenario question. Long-running; caller async. */
export function ask(cfg: ClientConfig, question: string): Promise<ClientOutcome<SbAskResponse>> {
  return request<SbAskResponse>(cfg, `/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
}

/** GET /api/stats — provider calibration / methodology. */
export function getStats(cfg: ClientConfig): Promise<ClientOutcome<SbStatsResponse>> {
  return request<SbStatsResponse>(cfg, `/api/stats`, { method: "GET" });
}

// lib/meetings/recording-share.ts
// A shared clip of a recording: the window it covers, whether it still works,
// and which of the recording's parts it may serve.
//
// Pure, apart from the token helpers' use of Web Crypto, so the client can
// format and the routes can enforce from one definition.

import type { TimelinePart } from "@/lib/meetings/recording-timeline";

/** How long a clip link may live, in days, and the choices offered. */
export const SHARE_DAYS = [1, 7, 30, 90] as const;
export const DEFAULT_SHARE_DAYS = 7;
export const SHARE_LABEL_MAX = 120;
/** The shortest clip worth a link, and the longest a clip may be (the rest is a download). */
export const MIN_CLIP_MS = 5_000;
export const MAX_CLIP_MS = 60 * 60_000;

export interface ShareWindow {
  startMs: number;
  endMs: number | null;
}

export type ShareState = "active" | "expired" | "revoked";

export function shareState(share: { expires_at: string; revoked_at: string | null }, now: number): ShareState {
  if (share.revoked_at) return "revoked";
  return new Date(share.expires_at).getTime() <= now ? "expired" : "active";
}

/**
 * A window as asked for, made valid: whole milliseconds, inside the
 * recording, at least MIN_CLIP_MS and at most MAX_CLIP_MS long. Null when
 * nothing sensible can be made of it.
 */
export function cleanWindow(startMs: unknown, endMs: unknown, durationMs: number): ShareWindow | null {
  const total = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
  let start = Math.max(0, Math.floor(Number(startMs) || 0));
  let end = endMs === null || endMs === undefined || endMs === "" ? null : Math.floor(Number(endMs));
  if (end !== null && !Number.isFinite(end)) return null;
  if (total !== null) {
    if (start >= total) return null;
    if (end !== null) end = Math.min(end, total);
  }
  if (end === null) end = total !== null ? Math.min(total, start + MAX_CLIP_MS) : start + MAX_CLIP_MS;
  if (end - start < MIN_CLIP_MS) {
    if (total !== null && start + MIN_CLIP_MS > total) start = Math.max(0, total - MIN_CLIP_MS);
    end = start + MIN_CLIP_MS;
  }
  if (end - start > MAX_CLIP_MS) end = start + MAX_CLIP_MS;
  return { startMs: start, endMs: end };
}

/** The label as stored: one line, trimmed, capped; null for nothing. */
export function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, SHARE_LABEL_MAX).trim();
  return t || null;
}

export function cleanDays(raw: unknown): number {
  const n = Number(raw);
  return (SHARE_DAYS as readonly number[]).includes(n) ? n : DEFAULT_SHARE_DAYS;
}

/**
 * The parts a clip may serve: the first (it carries the stream's header, and
 * nothing plays without it) and every part that overlaps the window, with one
 * part of slack either side so playback can start and finish cleanly.
 */
export function partsForWindow(parts: readonly TimelinePart[], w: ShareWindow): TimelinePart[] {
  if (!parts.length) return [];
  const end = w.endMs ?? Number.POSITIVE_INFINITY;
  const overlapping = parts
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.offsetMs < end && p.offsetMs + p.durationMs > w.startMs)
    .map(({ i }) => i);
  if (!overlapping.length) return [parts[0]];
  const from = Math.max(0, overlapping[0] - 1);
  const to = Math.min(parts.length - 1, overlapping[overlapping.length - 1] + 1);
  const chosen = new Set<number>([0]);
  for (let i = from; i <= to; i++) chosen.add(i);
  return [...chosen].sort((a, b) => a - b).map((i) => parts[i]);
}

/** Whether a byte range lies entirely inside the parts a clip may serve. */
export function rangeAllowed(allowed: readonly TimelinePart[], start: number, endInclusive: number): boolean {
  if (start > endInclusive) return false;
  let cursor = start;
  // Allowed parts are in byte order; walk them covering [start, end].
  for (const p of allowed) {
    if (p.end <= cursor) continue;
    if (p.start > cursor) return false;
    cursor = p.end;
    if (cursor > endInclusive) return true;
  }
  return false;
}

/** "0:42–2:10", the window in clock form. */
export function windowLabel(w: ShareWindow, clock: (ms: number) => string): string {
  return w.endMs === null ? `from ${clock(w.startMs)}` : `${clock(w.startMs)}–${clock(w.endMs)}`;
}

/** "Expires in 6 days", "Expired", "Revoked". */
export function expiryLabel(share: { expires_at: string; revoked_at: string | null }, now: number): string {
  const state = shareState(share, now);
  if (state === "revoked") return "Revoked";
  if (state === "expired") return "Expired";
  const days = Math.ceil((new Date(share.expires_at).getTime() - now) / 86_400_000);
  if (days <= 1) {
    const hours = Math.max(1, Math.ceil((new Date(share.expires_at).getTime() - now) / 3_600_000));
    return `Expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `Expires in ${days} days`;
}

/** "1:02:03", "2:10", "45" → milliseconds; null for anything else. */
export function parseClock(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,3}(?::\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.slice(1).some((n) => n > 59)) return null;
  const seconds = parts.reduce((acc, n) => acc * 60 + n, 0);
  return seconds * 1000;
}

/** 130000 → "2:10", 3723000 → "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

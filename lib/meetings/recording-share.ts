// lib/meetings/recording-share.ts
// A shared clip of a recording: the window it covers, whether it still works,
// and how its viewers are described to the person who shared it.
//
// The clip itself is cut on the server into a file of its own
// (lib/meetings/webm-clip.ts, recording-clip.server.ts); nothing here decides
// what bytes a link may reach any more.
//
// Pure, so the client can format and the routes can enforce from one
// definition.

import { transcriptCues, type CueRow, type TranscriptCue } from "@/lib/meetings/transcript-cues";

/** How long a clip link may live, in days, and the choices offered. */
export const SHARE_DAYS = [1, 7, 30, 90] as const;
export const DEFAULT_SHARE_DAYS = 7;
export const SHARE_LABEL_MAX = 120;
/**
 * The shortest clip worth a link, and the longest a clip may be. Twenty
 * minutes, because a clip is cut into a file of its own when the link is made
 * and that has to finish inside one server run; longer than that is a
 * download.
 */
export const MIN_CLIP_MS = 5_000;
export const MAX_CLIP_MS = 20 * 60_000;

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

export type ClipStatus = "pending" | "processing" | "ready" | "failed";

/** "Preparing…", "Ready", "Couldn't be made". */
export function clipStatusLabel(status: ClipStatus | string | null | undefined): string {
  if (status === "ready") return "Ready";
  if (status === "failed") return "Couldn't be made";
  return "Preparing…";
}

/**
 * A coarse description of a viewer's device, from their user agent: "Chrome
 * on macOS", "Safari on iPhone". This is all the access log keeps of it.
 */
export function deviceLabel(ua: string | null | undefined): string {
  const u = (ua ?? "").slice(0, 512);
  if (!u) return "Unknown device";
  if (/bot|crawler|spider|preview|slurp|facebookexternalhit|slackbot|whatsapp|telegram|discord|linkedin/i.test(u)) {
    return "Link preview";
  }
  const os = /iPhone/.test(u)
    ? "iPhone"
    : /iPad/.test(u)
      ? "iPad"
      : /Android/.test(u)
        ? "Android"
        : /Windows/.test(u)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(u)
            ? "macOS"
            : /CrOS/.test(u)
              ? "ChromeOS"
              : /Linux/.test(u)
                ? "Linux"
                : null;
  const browser = /Edg\//.test(u)
    ? "Edge"
    : /OPR\/|Opera/.test(u)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(u)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(u)
          ? "Chrome"
          : /Safari\//.test(u)
            ? "Safari"
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

export interface ShareView {
  kind: "open" | "download";
  viewer: string;
  device: string | null;
  createdAt: string;
}

/** "5 opens · 3 viewers · 1 download". */
export function viewSummary(views: readonly ShareView[]): { opens: number; viewers: number; downloads: number; text: string } {
  const opens = views.filter((v) => v.kind === "open").length;
  const downloads = views.filter((v) => v.kind === "download").length;
  const viewers = new Set(views.filter((v) => v.device !== "Link preview").map((v) => v.viewer)).size;
  const bits = [`${opens} ${opens === 1 ? "open" : "opens"}`, `${viewers} ${viewers === 1 ? "viewer" : "viewers"}`];
  if (downloads) bits.push(`${downloads} ${downloads === 1 ? "download" : "downloads"}`);
  return { opens, viewers, downloads, text: bits.join(" · ") };
}

/** "2 hours ago", "3 days ago", "just now". */
export function agoLabel(iso: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** A file name for a downloaded clip: the meeting's date, never its title. */
export function clipFilename(startedAt: string, mimeType: string): string {
  const at = new Date(startedAt);
  const day = isNaN(at.getTime()) ? "recording" : at.toISOString().slice(0, 10);
  return `${mimeType.startsWith("audio/") ? "call" : "meeting"}-clip-${day}.webm`;
}

/**
 * The words said inside a clip, on the clip's own clock.
 *
 * Rows are kept to the window BEFORE they are grouped into turns: grouping
 * first and filtering the turns kept a turn that began inside the window with
 * every later line the same speaker said, and one that began just before it
 * with all of its lines — words from outside the clip, on a public page.
 * `baseMs` is where the clip's file begins in the recording; cue times are
 * moved by it so they match the clip's player.
 */
export function clipCues(
  rows: readonly CueRow[],
  recordingStartedAt: string,
  window: { startMs: number; endMs: number | null },
  baseMs: number,
): TranscriptCue[] {
  const origin = Date.parse(recordingStartedAt);
  if (!Number.isFinite(origin)) return [];
  const end = window.endMs ?? Number.POSITIVE_INFINITY;
  const inside = rows.filter((r) => {
    const at = Date.parse(r.ts) - origin;
    return Number.isFinite(at) && at >= window.startMs && at < end;
  });
  return transcriptCues(inside, recordingStartedAt).map((c) => ({ ...c, atMs: Math.max(0, c.atMs - baseMs) }));
}

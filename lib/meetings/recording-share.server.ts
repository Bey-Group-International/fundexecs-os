// lib/meetings/recording-share.server.ts
// Minting, resolving, guarding and logging shared clips. See recording-share.ts
// for the window rules, recording-clip.server.ts for how a clip is cut into a
// file of its own, and the migrations for why only a hash of the token is kept.
import { createHash, randomBytes } from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, type RateLimitResult } from "@/lib/rate-limit";
import { buildTimeline, type StoredPart, type TimelinePart } from "@/lib/meetings/recording-timeline";
import { deviceLabel, shareState, type ClipStatus, type ShareView } from "@/lib/meetings/recording-share";
import { SITE_URL } from "@/lib/site";

/** The public page a clip's token opens. */
export function clipUrl(token: string): string {
  return `${SITE_URL.replace(/\/$/, "")}/s/clip/${token}`;
}

type Service = ReturnType<typeof createServiceClient>;

/** 192 random bits, URL-safe. */
export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A token's shape, checked before it costs a database read. */
export function looksLikeToken(token: string | undefined | null): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{24,64}$/.test(token);
}

export interface ShareRow {
  id: string;
  meeting_id: string;
  recording_id: string;
  label: string | null;
  start_ms: number;
  end_ms: number | null;
  expires_at: string;
  revoked_at: string | null;
  open_count: number;
  last_opened_at: string | null;
  created_at: string;
  clip_status?: ClipStatus | null;
  clip_error?: string | null;
  clip_offset_ms?: number | null;
  clip_duration_ms?: number | null;
  allow_download?: boolean | null;
}

export const SHARE_COLUMNS =
  "id, meeting_id, recording_id, label, start_ms, end_ms, expires_at, revoked_at, open_count, last_opened_at, created_at, clip_status, clip_error, clip_offset_ms, clip_duration_ms, allow_download";

export interface ResolvedShare {
  share: ShareRow;
  recording: { id: string; mime_type: string; started_at: string };
  meetingTitle: string;
}

export type ResolveFailure = "not_found" | "expired" | "revoked" | "deleted";

/** The share behind a token, with its recording, or why it does not work. */
export async function resolveShare(
  service: Service,
  token: string,
  now = Date.now(),
): Promise<ResolvedShare | { failure: ResolveFailure }> {
  if (!looksLikeToken(token)) return { failure: "not_found" };
  const { data } = await service.from("recording_shares").select(SHARE_COLUMNS).eq("token_hash", hashShareToken(token)).maybeSingle();
  const share = data as ShareRow | null;
  if (!share) return { failure: "not_found" };
  const state = shareState(share, now);
  if (state !== "active") return { failure: state };

  const [{ data: rec }, { data: meeting }] = await Promise.all([
    service.from("live_meeting_recordings").select("id, mime_type, started_at, deleted_at").eq("id", share.recording_id).maybeSingle(),
    service.from("live_meetings").select("title, deleted_at").eq("id", share.meeting_id).maybeSingle(),
  ]);
  const r = rec as { id: string; mime_type: string | null; started_at: string; deleted_at: string | null } | null;
  const m = meeting as { title: string | null; deleted_at: string | null } | null;
  if (!r || !m || m.deleted_at) return { failure: "not_found" };
  if (r.deleted_at) return { failure: "deleted" };
  return {
    share,
    recording: { id: r.id, mime_type: r.mime_type || "video/webm", started_at: r.started_at },
    meetingTitle: m.title?.trim() || "Meeting",
  };
}

/**
 * The clip's own parts, placed on its own clock (zero at its first frame).
 * Empty until the clip has been cut. These are the only bytes a clip link
 * can reach.
 */
export async function clipTimeline(service: Service, shareId: string): Promise<{ parts: TimelinePart[]; paths: Map<number, string> }> {
  const { data } = await (service as unknown as { from: (t: string) => any })
    .from("recording_share_parts")
    .select("idx, path, size, offset_ms, duration_ms")
    .eq("share_id", shareId)
    .order("idx", { ascending: true })
    .limit(2000);
  const rows = (data ?? []) as Array<StoredPart & { path: string }>;
  return { parts: buildTimeline(rows), paths: new Map(rows.map((r) => [r.idx, r.path])) };
}

/** Whether a resolved share's clip can be played yet. */
export function clipReady(share: ShareRow): boolean {
  return share.clip_status === "ready";
}

/** Count an opening. Best effort: a link that played is not failed by its counter. */
export async function recordOpen(service: Service, share: ShareRow, now = new Date()): Promise<void> {
  try {
    await service
      .from("recording_shares")
      .update({ open_count: (share.open_count ?? 0) + 1, last_opened_at: now.toISOString() } as never)
      .eq("id", share.id);
  } catch {
    // Uncounted, still watched.
  }
}

/** A clip as the host's list shows it: never the token, which only its creator ever saw. */
export function serializeShare(row: ShareRow) {
  return {
    id: row.id,
    label: row.label,
    startMs: row.start_ms,
    endMs: row.end_ms,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    openCount: row.open_count,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    clipStatus: (row.clip_status ?? "pending") as ClipStatus,
    clipError: row.clip_error ?? null,
    clipDurationMs: row.clip_duration_ms ?? null,
    allowDownload: row.allow_download === true,
  };
}

// ── The access log ────────────────────────────────────────────────────────

/**
 * Who a viewer is, for counting them: a hash of their address salted with the
 * link, so the same person is one viewer of this link, and nothing can be
 * learned about them or matched across links.
 */
export function viewerHash(ip: string, shareId: string): string {
  return createHash("sha256").update(`${shareId}:${ip}`).digest("hex").slice(0, 24);
}

/** Write one entry of the access log. Best effort: a log that failed never stops the clip. */
export async function recordView(
  service: Service,
  share: ShareRow,
  viewer: { ip: string; userAgent: string | null },
  kind: "open" | "download",
): Promise<void> {
  try {
    await (service as unknown as { from: (t: string) => any }).from("recording_share_views").insert({
      share_id: share.id,
      kind,
      viewer: viewerHash(viewer.ip, share.id),
      device: deviceLabel(viewer.userAgent).slice(0, 80),
    });
  } catch {
    // Unlogged, still watched.
  }
}

/** A link's access log, newest first, as its creator's own client may read it. */
export function serializeView(row: { kind: string; viewer: string; device: string | null; created_at: string }): ShareView {
  return { kind: row.kind === "download" ? "download" : "open", viewer: row.viewer, device: row.device, createdAt: row.created_at };
}

// ── Guards for the public routes ──────────────────────────────────────────

/** Openings of one link per hour, across every server, before it pauses. */
export const SHARE_OPENS_PER_HOUR = 300;
/** Bad tokens one address may try in ten minutes before every token is refused. */
export const MISSES_PER_WINDOW = 10;
const MISS_WINDOW_MS = 10 * 60_000;

/** What each public clip route allows one address, per minute. */
export const CLIP_ROUTE_LIMITS = {
  page: 30,
  parts: 60,
  stream: 240,
} as const;

/**
 * The per-address guard every public clip route runs first: its own rate, and
 * whether this address has been guessing tokens. Answers null to go ahead.
 */
export function guardClipRequest(ip: string, route: keyof typeof CLIP_ROUTE_LIMITS, now = Date.now()): RateLimitResult | null {
  const blocked = misses.get(ip);
  if (blocked && blocked.resetAt > now && blocked.count >= MISSES_PER_WINDOW) {
    return { ok: false, remaining: 0, resetAt: blocked.resetAt, retryAfter: Math.ceil((blocked.resetAt - now) / 1000) };
  }
  const limit = checkRateLimit({ key: `clip-${route}:${ip}`, limit: CLIP_ROUTE_LIMITS[route], windowMs: 60_000 }, now);
  return limit.ok ? null : limit;
}

const misses = new Map<string, { count: number; resetAt: number }>();

/** Count a token that matched nothing. */
export function noteMiss(ip: string, now = Date.now()): void {
  const m = misses.get(ip);
  if (!m || m.resetAt <= now) misses.set(ip, { count: 1, resetAt: now + MISS_WINDOW_MS });
  else m.count += 1;
  if (misses.size > 10_000) {
    for (const [k, v] of misses) if (v.resetAt <= now) misses.delete(k);
  }
}

export function clearClipGuardsForTests(): void {
  misses.clear();
}

/** Whether a link has been opened more than SHARE_OPENS_PER_HOUR times in the last hour. */
export async function overHourlyCap(service: Service, shareId: string, now = Date.now()): Promise<boolean> {
  try {
    const { count } = await (service as unknown as { from: (t: string) => any })
      .from("recording_share_views")
      .select("id", { count: "exact", head: true })
      .eq("share_id", shareId)
      .gte("created_at", new Date(now - 3_600_000).toISOString());
    return typeof count === "number" && count >= SHARE_OPENS_PER_HOUR;
  } catch {
    return false;
  }
}

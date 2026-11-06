// lib/meetings/recording-share.server.ts
// Minting, resolving and counting shared clips. See recording-share.ts for the
// window rules and the migration for why only a hash of the token is kept.
import { createHash, randomBytes } from "crypto";
import type { createServiceClient } from "@/lib/supabase/server";
import { readAllRecordingParts } from "@/lib/meetings/recording-parts";
import { buildTimeline, type StoredPart, type TimelinePart } from "@/lib/meetings/recording-timeline";
import { partsForWindow, shareState } from "@/lib/meetings/recording-share";
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
}

export const SHARE_COLUMNS =
  "id, meeting_id, recording_id, label, start_ms, end_ms, expires_at, revoked_at, open_count, last_opened_at, created_at";

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

/** The whole timeline, and the part of it this clip may serve. */
export async function clipTimeline(service: Service, resolved: ResolvedShare): Promise<{ all: TimelinePart[]; allowed: TimelinePart[] }> {
  const rows = await readAllRecordingParts<StoredPart & { path: string }>(
    service as never,
    resolved.share.recording_id,
    "idx, path, size, offset_ms, duration_ms",
  );
  const all = buildTimeline(rows);
  return { all, allowed: partsForWindow(all, { startMs: resolved.share.start_ms, endMs: resolved.share.end_ms }) };
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
  };
}

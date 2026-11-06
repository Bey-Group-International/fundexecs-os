// lib/meetings/recording-clip.server.ts
// Cutting a shared clip into a file of its own, and clearing it away when the
// link is over.
//
// The recording's parts are read from the window's start (less a lookback, to
// find the keyframe before it) to just past its end, run through the WebM
// clipper, and written back as the clip's own parts beside the recording's:
//
//   <meeting>/<recording>/clip-<share>-part-NNNNNN.webm
//
// Beside them, so deleting a recording (one prefix) deletes its clips too.
// The public clip routes read `recording_share_parts` and nothing else, so a
// clip link can only ever reach the clip.
//
// Runs after the link is made (next/server `after`) and again from the
// hourly sweep for anything that did not finish: a clip that fails is retried
// a few times, then left failed with the reason for its creator to see.

import type { createServiceClient } from "@/lib/supabase/server";
import { RECORDING_BUCKET } from "@/lib/meetings/recording-policy";
import { readAllRecordingParts } from "@/lib/meetings/recording-parts";
import { buildTimeline, type StoredPart, type TimelinePart } from "@/lib/meetings/recording-timeline";
import { ClipPartPacker, WebmClipError, WebmClipper, canClip, concatBytes, type ClipCluster } from "@/lib/meetings/webm-clip";

type Service = ReturnType<typeof createServiceClient>;
type Db = { from: (table: string) => any; storage: Service["storage"] };

/** How far before the window's start to read, looking for a keyframe to open on. */
export const KEYFRAME_LOOKBACK_MS = 30_000;
/** Read this far past the end, for frames muxed a little late. */
const END_LOOKAHEAD_MS = 5_000;
/** Attempts before a clip is left failed. */
export const MAX_CLIP_ATTEMPTS = 3;
/** A clip "processing" for longer than this was abandoned by a run that died. */
const STALE_PROCESSING_MS = 15 * 60_000;
const READ_AHEAD = 4;
const UPLOAD_CONCURRENCY = 4;

export function clipPartPath(meetingId: string, recordingId: string, shareId: string, idx: number): string {
  return `${meetingId}/${recordingId}/clip-${shareId}-part-${String(idx).padStart(6, "0")}.webm`;
}

/** The recording parts a window needs: the first (it holds the header) and those around the window. */
export function partsToRead(parts: readonly TimelinePart[], startMs: number, endMs: number): TimelinePart[] {
  const from = startMs - KEYFRAME_LOOKBACK_MS;
  const to = endMs + END_LOOKAHEAD_MS;
  return parts.filter((p, i) => i === 0 || (p.offsetMs + p.durationMs > from && p.offsetMs < to));
}

interface ShareForClip {
  id: string;
  meeting_id: string;
  recording_id: string;
  start_ms: number;
  end_ms: number | null;
  expires_at: string;
  revoked_at: string | null;
  clip_status: string;
  clip_attempts: number | null;
  clip_started_at: string | null;
}

const CLIP_SHARE_COLUMNS =
  "id, meeting_id, recording_id, start_ms, end_ms, expires_at, revoked_at, clip_status, clip_attempts, clip_started_at";

export type BuildResult =
  | { ok: true; parts: number; bytes: number; durationMs: number }
  | { ok: false; error: string; skipped?: boolean };

/** Claim a clip for cutting. Null when another run has it, or it needs nothing. */
async function claim(db: Db, shareId: string, now: Date): Promise<ShareForClip | null> {
  const { data } = await db.from("recording_shares").select(CLIP_SHARE_COLUMNS).eq("id", shareId).maybeSingle();
  const share = data as ShareForClip | null;
  if (!share || share.revoked_at || Date.parse(share.expires_at) <= now.getTime()) return null;
  const stale = share.clip_status === "processing" && (!share.clip_started_at || now.getTime() - Date.parse(share.clip_started_at) > STALE_PROCESSING_MS);
  if (!(share.clip_status === "pending" || share.clip_status === "failed" || stale)) return null;
  if ((share.clip_attempts ?? 0) >= MAX_CLIP_ATTEMPTS && share.clip_status === "failed") return null;

  // Conditional on the state just read: two runs cannot both win.
  let q = db
    .from("recording_shares")
    .update({ clip_status: "processing", clip_started_at: now.toISOString(), clip_attempts: (share.clip_attempts ?? 0) + 1 })
    .eq("id", shareId)
    .eq("clip_status", share.clip_status);
  q = share.clip_started_at ? q.eq("clip_started_at", share.clip_started_at) : q.is("clip_started_at", null);
  const { data: claimed } = await q.select("id");
  return Array.isArray(claimed) && claimed.length ? share : null;
}

async function removePaths(db: Db, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    try {
      await db.storage.from(RECORDING_BUCKET).remove(paths.slice(i, i + 100));
    } catch {
      // Left for the recording's own deletion to take with it.
    }
  }
}

/** Cut one clip. Never throws. */
export async function buildClip(service: Service, shareId: string, opts: { now?: Date } = {}): Promise<BuildResult> {
  const db = service as unknown as Db;
  const now = opts.now ?? new Date();
  let share: ShareForClip | null = null;
  try {
    share = await claim(db, shareId, now);
  } catch {
    share = null;
  }
  if (!share) return { ok: false, error: "Nothing to do", skipped: true };

  const uploaded: string[] = [];
  const fail = async (error: string): Promise<BuildResult> => {
    await removePaths(db, uploaded);
    await db.from("recording_share_parts").delete().eq("share_id", shareId);
    await db
      .from("recording_shares")
      .update({ clip_status: "failed", clip_error: error.slice(0, 300) })
      .eq("id", shareId);
    return { ok: false, error };
  };

  try {
    const { data: rec } = await db
      .from("live_meeting_recordings")
      .select("id, mime_type, deleted_at")
      .eq("id", share.recording_id)
      .maybeSingle();
    const recording = rec as { id: string; mime_type: string | null; deleted_at: string | null } | null;
    if (!recording || recording.deleted_at) return await fail("The recording is no longer available.");
    if (!canClip(recording.mime_type)) {
      return await fail("Clips can only be cut from WebM recordings. This one was recorded in Safari — download it to share a part.");
    }

    const rows = await readAllRecordingParts<StoredPart & { path: string }>(service as never, share.recording_id, "idx, path, size, offset_ms, duration_ms");
    const timeline = buildTimeline(rows);
    const pathOf = new Map(rows.map((r) => [r.idx, r.path]));
    const total = timeline.length ? timeline[timeline.length - 1].offsetMs + timeline[timeline.length - 1].durationMs : 0;
    const startMs = share.start_ms;
    const endMs = Math.min(share.end_ms ?? total, total || Number.POSITIVE_INFINITY);
    if (!timeline.length || !(endMs > startMs)) return await fail("That part of the recording doesn't exist.");

    const wanted = partsToRead(timeline, startMs, endMs);
    const clipper = new WebmClipper({ startMs, endMs });
    const packer = new ClipPartPacker();
    const storage = db.storage.from(RECORDING_BUCKET);
    const contentType = (recording.mime_type || "video/webm").split(";")[0];

    // Parts after the first are uploaded as they fill; the first waits for the
    // end, because it carries the header and the header carries the duration.
    let first: ClipCluster[] | null = null;
    const stored: { idx: number; path: string; size: number; offsetMs: number; lastMs: number }[] = [];
    const uploads: Promise<void>[] = [];
    let nextIdx = 0;
    const store = async (idx: number, bytes: Uint8Array, offsetMs: number, lastMs: number) => {
      const path = clipPartPath(share!.meeting_id, share!.recording_id, shareId, idx);
      const { error } = await storage.upload(path, bytes, { contentType, upsert: true });
      if (error) throw new Error(`Could not store the clip: ${error.message ?? "upload failed"}`);
      uploaded.push(path);
      stored.push({ idx, path, size: bytes.byteLength, offsetMs, lastMs });
    };
    const take = async (groups: ClipCluster[][]) => {
      for (const g of groups) {
        const idx = nextIdx++;
        if (idx === 0) {
          first = g;
          continue;
        }
        if (uploads.length >= UPLOAD_CONCURRENCY) await uploads.shift();
        const p = store(idx, concatBytes(g.map((c) => c.bytes)), g[0].startMs, g[g.length - 1].lastMs);
        p.catch(() => {});
        uploads.push(p);
      }
    };

    const download = async (idx: number) => {
      const path = pathOf.get(idx);
      if (!path) throw new Error("A part of the recording is missing.");
      const { data, error } = await storage.download(path);
      if (error || !data) throw new Error("Could not read the recording.");
      return new Uint8Array(await data.arrayBuffer());
    };
    const queue = wanted.map((p) => p.idx);
    const inflight: { idx: number; bytes: Promise<Uint8Array> }[] = [];
    const fill = () => {
      while (inflight.length < READ_AHEAD && queue.length) {
        const idx = queue.shift()!;
        const bytes = download(idx);
        bytes.catch(() => {});
        inflight.push({ idx, bytes });
      }
    };

    let prev: number | null = null;
    fill();
    while (inflight.length && !clipper.done) {
      const next = inflight.shift()!;
      const bytes = await next.bytes;
      fill();
      const resync = prev !== null && next.idx !== prev + 1;
      prev = next.idx;
      await take(packer.add(clipper.push(bytes, { resync })));
    }
    await take(packer.add(clipper.end()));
    const rest = packer.finish();
    if (rest) await take([rest]);
    await Promise.all(uploads);

    if (!clipper.hasFrames || !first) return await fail("There's nothing to play in that part of the recording.");
    const head: ClipCluster[] = first;
    await store(0, concatBytes([clipper.header(), ...head.map((c) => c.bytes)]), 0, head[head.length - 1].lastMs);

    stored.sort((a, b) => a.idx - b.idx);
    const durationMs = Math.round(clipper.durationMs);
    const partRows = stored.map((s, i) => {
      const nextOffset = stored[i + 1]?.offsetMs ?? durationMs + 20;
      return {
        share_id: shareId,
        idx: s.idx,
        path: s.path,
        size: s.size,
        offset_ms: Math.max(0, Math.round(s.offsetMs)),
        duration_ms: Math.max(1, Math.round(nextOffset - s.offsetMs)),
      };
    });
    await db.from("recording_share_parts").delete().eq("share_id", shareId);
    const { error: rowsError } = await db.from("recording_share_parts").insert(partRows);
    if (rowsError) throw new Error("Could not record the clip.");
    const bytes = stored.reduce((n, s) => n + s.size, 0);
    await db
      .from("recording_shares")
      .update({
        clip_status: "ready",
        clip_error: null,
        clip_offset_ms: Math.round(clipper.baseMs),
        clip_duration_ms: durationMs,
        clip_bytes: bytes,
      })
      .eq("id", shareId);
    return { ok: true, parts: stored.length, bytes, durationMs };
  } catch (err) {
    const message =
      err instanceof WebmClipError
        ? `The recording couldn't be read: ${err.message}.`
        : err instanceof Error
          ? err.message
          : "The clip couldn't be made.";
    console.warn("[recording-clip] could not cut clip", shareId, err);
    return await fail(message);
  }
}

/** Delete a clip's media and rows. Best effort; returns objects removed. */
export async function purgeClip(service: Service, shareId: string, now = new Date()): Promise<number> {
  const db = service as unknown as Db;
  const { data } = await db.from("recording_share_parts").select("path").eq("share_id", shareId);
  const paths = ((data ?? []) as { path: string }[]).map((r) => r.path);
  await removePaths(db, paths);
  await db.from("recording_share_parts").delete().eq("share_id", shareId);
  await db.from("recording_shares").update({ purged_at: now.toISOString() }).eq("id", shareId);
  return paths.length;
}

export interface ClipSweepStats {
  cut: number;
  failed: number;
  purged: number;
}

const MAX_CUTS_PER_PASS = 2;
const MAX_PURGES_PER_PASS = 100;

/**
 * The hourly pass: cut clips that are still waiting (links made before
 * trimming existed, and any run that died), and clear away the media of links
 * that have expired or been turned off.
 */
export async function runClipSweep(service: Service, now = new Date()): Promise<ClipSweepStats> {
  const db = service as unknown as Db;
  const stats: ClipSweepStats = { cut: 0, failed: 0, purged: 0 };

  try {
    // Not the last couple of minutes: those are being cut by the request that made them.
    const { data } = await db
      .from("recording_shares")
      .select("id, clip_status, clip_attempts")
      .in("clip_status", ["pending", "processing", "failed"])
      .is("revoked_at", null)
      .is("purged_at", null)
      .gt("expires_at", now.toISOString())
      .lt("created_at", new Date(now.getTime() - 2 * 60_000).toISOString())
      .lt("clip_attempts", MAX_CLIP_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(MAX_CUTS_PER_PASS);
    for (const row of (data ?? []) as { id: string }[]) {
      const res = await buildClip(service, row.id, { now });
      if (res.ok) stats.cut += 1;
      else if (!res.skipped) stats.failed += 1;
    }
  } catch (err) {
    console.warn("[recording-clip] sweep could not cut clips", err);
  }

  try {
    const nowIso = now.toISOString();
    const { data } = await db
      .from("recording_shares")
      .select("id")
      .is("purged_at", null)
      .or(`revoked_at.not.is.null,expires_at.lte.${nowIso}`)
      .limit(MAX_PURGES_PER_PASS);
    for (const row of (data ?? []) as { id: string }[]) {
      await purgeClip(service, row.id, now);
      stats.purged += 1;
    }
  } catch (err) {
    console.warn("[recording-clip] sweep could not clear clips", err);
  }
  return stats;
}

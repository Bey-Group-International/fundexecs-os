// lib/meetings/recording-outbox.ts
// Recording parts that could not be uploaded, kept on this device until they
// can be.
//
// The upload path retries a part three times inside about eight seconds and
// then, before this, gave it up: a train tunnel, a hotel wifi captive portal or
// a laptop lid closed mid-meeting cost every part produced while it lasted,
// and the recording was filed with holes. Now a part that runs out of retries
// — or is produced while the browser says it is offline — is written to
// IndexedDB instead, and uploaded the next time this device opens FundExecs
// with a connection. The recording fills in after the fact.
//
// Storing it again is safe for the same reason retrying is: the object's path
// comes from the part's own index with `upsert`, and its row upserts on
// (recording_id, idx). A part that lands twice is a part that landed once.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { RECORDING_BUCKET } from "@/lib/meetings/recording-policy";
import { classifyUploadError } from "@/lib/meetings/upload-retry";

type Client = SupabaseClient<Database>;

export interface OutboxPart {
  /** `${recordingId}:${idx}` — one entry per part, however often it is saved. */
  key: string;
  meetingId: string;
  recordingId: string;
  idx: number;
  path: string;
  mimeType: string;
  blob: Blob;
  offsetMs: number;
  durationMs: number;
  savedAt: number;
}

/** Where saved parts live. IndexedDB in a browser; a Map in a test. */
export interface OutboxStore {
  put(part: OutboxPart): Promise<boolean>;
  all(): Promise<OutboxPart[]>;
  remove(key: string): Promise<void>;
}

export function outboxKey(recordingId: string, idx: number): string {
  return `${recordingId}:${idx}`;
}

/** An in-memory store, for tests and for a browser with no IndexedDB. */
export function memoryOutbox(): OutboxStore {
  const map = new Map<string, OutboxPart>();
  return {
    async put(part) {
      map.set(part.key, part);
      return true;
    },
    async all() {
      return [...map.values()];
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

const DB_NAME = "fx-recording-outbox";
const DB_VERSION = 1;
const STORE = "parts";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then((db) => {
    if (!db) return null;
    return new Promise<T | null>((resolve) => {
      let request: IDBRequest<T>;
      try {
        request = work(db.transaction(STORE, mode).objectStore(STORE));
      } catch {
        db.close();
        resolve(null);
        return;
      }
      request.onsuccess = () => {
        resolve(request.result);
        db.close();
      };
      request.onerror = () => {
        resolve(null);
        db.close();
      };
    });
  });
}

/** The browser's store, or null where IndexedDB cannot be opened at all. */
export function idbOutbox(): OutboxStore | null {
  if (typeof indexedDB === "undefined") return null;
  return {
    async put(part) {
      return (await run("readwrite", (s) => s.put(part))) !== null;
    },
    async all() {
      return (await run<OutboxPart[]>("readonly", (s) => s.getAll() as IDBRequest<OutboxPart[]>)) ?? [];
    },
    async remove(key) {
      await run("readwrite", (s) => s.delete(key));
    },
  };
}

/** Upload one part and write its row. Throws what Storage or the table threw. */
export async function storePart(client: Client, part: Pick<OutboxPart, "recordingId" | "idx" | "path" | "mimeType" | "blob" | "offsetMs" | "durationMs">): Promise<void> {
  const { error: uploadError } = await client.storage
    .from(RECORDING_BUCKET)
    .upload(part.path, part.blob, { contentType: part.mimeType, upsert: true });
  if (uploadError) throw uploadError;
  const { error: rowError } = await client.from("live_meeting_recording_chunks").upsert(
    {
      recording_id: part.recordingId,
      idx: part.idx,
      path: part.path,
      size: part.blob.size,
      offset_ms: part.offsetMs,
      duration_ms: part.durationMs,
    },
    { onConflict: "recording_id,idx" },
  );
  if (rowError) throw rowError;
}

/** A refusal that a signed-in session later could turn into a yes. */
function mayLaterSucceed(err: unknown): boolean {
  const raw = err as { status?: unknown; statusCode?: unknown } | null;
  const status = Number(raw?.status ?? raw?.statusCode);
  return status === 401 || status === 403;
}

export interface RecordingTotals {
  size_bytes: number | null;
  chunk_count: number | null;
  duration_seconds: number | null;
}

/**
 * A recording row's totals once some saved parts have landed: their bytes and
 * count added, and the duration pushed out to the furthest point any of them
 * reaches. Pure, so the arithmetic is tested without a database.
 */
export function totalsAfterRecovery(
  row: RecordingTotals,
  landed: ReadonlyArray<Pick<OutboxPart, "blob" | "offsetMs" | "durationMs">>,
): Required<{ [K in keyof RecordingTotals]: number }> {
  const furthest = landed.reduce((max, p) => Math.max(max, p.offsetMs + p.durationMs), 0);
  return {
    size_bytes: (row.size_bytes ?? 0) + landed.reduce((sum, p) => sum + p.blob.size, 0),
    chunk_count: (row.chunk_count ?? 0) + landed.length,
    duration_seconds: Math.max(row.duration_seconds ?? 0, Math.round(furthest / 1000)),
  };
}

export interface DrainResult {
  uploaded: number;
  /** Still saved: the network, or a session that may come back. */
  kept: number;
  /** Refused for good (too large, malformed) and removed. */
  discarded: number;
}

/**
 * Upload every saved part this device holds, oldest first, and correct each
 * affected recording's totals. A part that fails for a reason that may pass is
 * kept for next time; one refused for good is removed rather than retried
 * forever. Never throws.
 */
export async function drainOutbox(client: Client, store: OutboxStore): Promise<DrainResult> {
  const result: DrainResult = { uploaded: 0, kept: 0, discarded: 0 };
  let parts: OutboxPart[];
  try {
    parts = (await store.all()).sort((a, b) => a.savedAt - b.savedAt || a.idx - b.idx);
  } catch {
    return result;
  }
  const landedBy = new Map<string, OutboxPart[]>();
  for (const part of parts) {
    try {
      await storePart(client, part);
      await store.remove(part.key);
      result.uploaded += 1;
      landedBy.set(part.recordingId, [...(landedBy.get(part.recordingId) ?? []), part]);
    } catch (err) {
      if (classifyUploadError(err) === "retry" || mayLaterSucceed(err)) {
        result.kept += 1;
      } else {
        await store.remove(part.key);
        result.discarded += 1;
      }
    }
  }
  for (const [recordingId, landed] of landedBy) {
    try {
      const { data } = await client
        .from("live_meeting_recordings")
        .select("size_bytes, chunk_count, duration_seconds")
        .eq("id", recordingId)
        .maybeSingle();
      if (!data) continue;
      await client
        .from("live_meeting_recordings")
        .update(totalsAfterRecovery(data as RecordingTotals, landed))
        .eq("id", recordingId);
    } catch {
      // The parts are stored and playable; only the listed totals are stale.
    }
  }
  return result;
}

/** What to tell the host about parts kept on this device, or null for none. */
export function savedPartsNotice(saved: number, chunkMs: number): string | null {
  if (!Number.isFinite(saved) || saved <= 0) return null;
  const seconds = Math.round((saved * chunkMs) / 1000);
  const amount =
    seconds >= 60
      ? `About ${Math.round(seconds / 60)} minute${Math.round(seconds / 60) === 1 ? "" : "s"}`
      : `About ${seconds} second${seconds === 1 ? "" : "s"}`;
  return `${amount} of this recording couldn't upload yet and is saved on this device. It will upload automatically the next time you open FundExecs here with a connection.`;
}

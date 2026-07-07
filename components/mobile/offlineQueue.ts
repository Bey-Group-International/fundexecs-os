"use client";

import { useEffect, useState } from "react";

// Durable "retry-on-reconnect" action queue for the mobile app.
//
// On-the-go operators fire actions (approve a deal, log a note, kick off a
// workflow) from elevators, basements and tunnels where connectivity comes and
// goes. Losing those actions to a dropped connection is unacceptable, so every
// mutation is enqueued here first: it is mirrored to localStorage (so it
// survives a reload or an app kill) and drained automatically the moment the
// device is back online. Each item type registers an executor that knows how to
// perform the real network call and reports whether it succeeded.
//
// Everything is SSR-safe: this module can be imported on the server (Next.js
// App Router) without touching `window`, `localStorage` or `navigator`.

/** A single queued action awaiting execution. */
export interface QueueItem {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
}

/** Executor signature: resolve `true` on success (drop the item), `false` to keep it for a later retry. */
type Executor = (payload: unknown) => Promise<boolean>;

// Persistence key. Namespaced so it never collides with other app state.
const STORAGE_KEY = "fx:offline-queue";

// Hard cap on buffered actions. On a device offline for a long stretch we would
// rather drop the oldest intents than let the queue (and its localStorage
// mirror) grow without bound.
const MAX_ITEMS = 100;

// Actions older than this are considered stale and are dropped rather than
// fired. Replaying a day-old "approve" the moment connectivity returns would be
// surprising and potentially harmful, so expiry beats blind retry.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Module-level state. A single shared queue is intentional: the whole app
// funnels through one durable pipe, and the count is reflected everywhere.
let queue: QueueItem[] = load();
const executors = new Map<string, Executor>();
const subscribers = new Set<(pending: number) => void>();

// Optional per-type labelers producing a human-friendly line for the UI.
const labelers = new Map<string, (payload: unknown) => string>();

// Guards against overlapping flushes (e.g. an `online` event firing mid-drain).
let flushing = false;

/** Read the persisted queue. Returns an empty list on the server or on any parse failure. */
function load(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Drop anything that already expired while the app was closed.
    return prune(parsed as QueueItem[]);
  } catch {
    /* ignore */
    return [];
  }
}

/**
 * Remove expired items (older than `MAX_AGE_MS`). Operates on a given list and
 * returns the survivors, so it can prune both freshly parsed data and the live
 * queue in place (via `queue = prune(queue)`).
 */
function prune(items: QueueItem[]): QueueItem[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return items.filter((i) => i.createdAt >= cutoff);
}

/** Mirror the in-memory queue to localStorage so it survives reloads and cold starts. */
function persist(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
}

/** Fan out the current pending count to every subscriber. */
function notify(): void {
  const pending = queue.length;
  for (const cb of subscribers) cb(pending);
}

/** Are we currently online? Assume yes when `navigator` is unavailable (SSR / very old browsers). */
function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/** Generate a unique id for a queued item. */
function makeId(): string {
  return (
    crypto.randomUUID?.() ??
    String(Date.now()) + Math.random().toString(36).slice(2)
  );
}

/**
 * Register how to execute a given item type. Registering immediately attempts a
 * flush so items queued before this executor existed (including ones restored
 * from a previous session) get drained as soon as their handler is available.
 */
export function registerExecutor(type: string, run: Executor): void {
  executors.set(type, run);
  void flush();
}

/**
 * Queue an action. Persists it, notifies subscribers, and — if we appear to be
 * online — optimistically attempts to drain right away. Returns the item id so
 * callers can correlate later. Never throws on network conditions.
 */
export function enqueue(type: string, payload: unknown): string {
  // Drop stale actions before doing anything else.
  queue = prune(queue);

  // Dedupe: if an identical pending action (same type + same payload) is already
  // buffered, keep it rather than double-submitting. Guards against a user
  // tapping twice on a flaky connection.
  const serialized = JSON.stringify(payload);
  const existing = queue.find(
    (i) => i.type === type && JSON.stringify(i.payload) === serialized,
  );
  if (existing) {
    // Still worth attempting a drain in case connectivity just returned.
    if (isOnline()) void flush();
    return existing.id;
  }

  const item: QueueItem = {
    id: makeId(),
    type,
    payload,
    createdAt: Date.now(),
  };
  queue.push(item);

  // Enforce the cap by dropping the oldest items from the front.
  if (queue.length > MAX_ITEMS) {
    queue = queue.slice(queue.length - MAX_ITEMS);
  }

  persist();
  notify();
  if (isOnline()) void flush();
  return item.id;
}

/**
 * Drain the queue. Runs each item that has a registered executor sequentially
 * (order matters for dependent actions); on success the item is removed, on a
 * `false` result or a thrown error it is kept for the next attempt. No-ops when
 * offline or when a flush is already in progress.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  if (!isOnline()) return;

  // Never fire actions that have aged out.
  queue = prune(queue);

  flushing = true;
  try {
    // Snapshot the current items; new enqueues during the drain are handled by
    // a subsequent flush rather than mutating the list we're iterating.
    const pendingItems = [...queue];
    const survivors: QueueItem[] = [];

    for (const item of pendingItems) {
      const run = executors.get(item.type);
      if (!run) {
        // No handler yet — keep it until one registers.
        survivors.push(item);
        continue;
      }
      try {
        const ok = await run(item.payload);
        if (!ok) survivors.push(item);
      } catch {
        /* ignore */
        // Keep the item; a transient failure should be retried later.
        survivors.push(item);
      }
    }

    // Preserve any items enqueued while we were awaiting executors.
    const drainedIds = new Set(pendingItems.map((i) => i.id));
    const arrivedDuringFlush = queue.filter((i) => !drainedIds.has(i.id));
    queue = [...survivors, ...arrivedDuringFlush];

    persist();
    notify();
  } finally {
    flushing = false;
  }
}

/** Number of actions still awaiting successful execution. */
export function getPending(): number {
  return queue.length;
}

/** Snapshot of the current pending items (a copy — callers must not mutate the queue). */
export function getItems(): QueueItem[] {
  return [...queue];
}

/** Remove a single queued item by id, then persist and notify. Safe if the id is unknown. */
export function remove(id: string): void {
  queue = queue.filter((i) => i.id !== id);
  persist();
  notify();
}

/**
 * Register a human-friendly labeler for a given item type. The UI uses this to
 * describe a pending action (e.g. "Approve Series B — Acme"). Optional; types
 * without a labeler fall back to a humanized version of the type string.
 */
export function registerLabeler(
  type: string,
  fn: (payload: unknown) => string,
): void {
  labelers.set(type, fn);
}

/**
 * Produce a display label for a queued item. Uses the registered labeler when
 * present (guarded so a throwing labeler can never break rendering) and
 * otherwise humanizes the type string, e.g. "approval-decision" → "Approval
 * decision".
 */
export function labelFor(item: QueueItem): string {
  const fn = labelers.get(item.type);
  if (fn) {
    try {
      return fn(item.payload);
    } catch {
      /* ignore */
    }
  }
  const words = item.type.replace(/[-_]+/g, " ").trim();
  if (!words) return "Pending action";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Subscribe to pending-count changes. Returns an unsubscribe function. Handy for
 * badges and banners that show how much work is still buffered.
 */
export function subscribe(cb: (pending: number) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

// Auto-flush on reconnect. Registered once at module load, guarded for SSR, so
// the queue drains the instant the device regains connectivity — no user action
// or re-render required.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    void flush();
  });
}

/**
 * React hook exposing the live pending count and a manual `flush` trigger.
 * Subscribes on mount and unsubscribes on unmount.
 */
export function usePendingSync(): { pending: number; flush: () => void } {
  const [pending, setPending] = useState<number>(getPending());

  useEffect(() => {
    // Re-sync on mount in case the count changed between render and effect.
    setPending(getPending());
    return subscribe(setPending);
  }, []);

  return {
    pending,
    flush: () => {
      void flush();
    },
  };
}

/**
 * React hook exposing the live list of pending items plus `remove` and `flush`.
 * Powers the "pending sync" review UI. Subscribes on mount and re-reads
 * `getItems()` on every notification so the list stays in sync with the queue.
 */
export function useQueueItems(): {
  items: QueueItem[];
  remove: (id: string) => void;
  flush: () => void;
} {
  const [items, setItems] = useState<QueueItem[]>(getItems());

  useEffect(() => {
    // Re-sync on mount in case the queue changed between render and effect.
    setItems(getItems());
    // The subscriber fires with the pending count; we ignore it and re-read the
    // full item list instead.
    return subscribe(() => {
      setItems(getItems());
    });
  }, []);

  return {
    items,
    remove,
    flush: () => {
      void flush();
    },
  };
}

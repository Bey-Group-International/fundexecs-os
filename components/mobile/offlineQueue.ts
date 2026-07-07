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

// Module-level state. A single shared queue is intentional: the whole app
// funnels through one durable pipe, and the count is reflected everywhere.
let queue: QueueItem[] = load();
const executors = new Map<string, Executor>();
const subscribers = new Set<(pending: number) => void>();

// Guards against overlapping flushes (e.g. an `online` event firing mid-drain).
let flushing = false;

/** Read the persisted queue. Returns an empty list on the server or on any parse failure. */
function load(): QueueItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch {
    /* ignore */
    return [];
  }
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
  const item: QueueItem = {
    id: makeId(),
    type,
    payload,
    createdAt: Date.now(),
  };
  queue.push(item);
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

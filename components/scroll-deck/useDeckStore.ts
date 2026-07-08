"use client";

// Client-side state + persistence for the fund deck. Applied sections survive
// reloads via localStorage; a single pending section models the review flow.
//
// React purity note: every setState updater below is PURE. Unique instance keys
// come from a useRef counter that is ONLY read/incremented in event handlers
// (never inside an updater), so React Strict Mode's double-invocation of
// updaters in dev can't double-apply a key or nest state writes.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppliedSection, DeckSection, PendingSection } from "./types";

const STORAGE_KEY = "scroll-deck:deck:v1";

function readStored(): AppliedSection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Trust the shape loosely — it's our own data — but guard against garbage.
    return parsed.filter(
      (s): s is AppliedSection =>
        s && typeof s.key === "number" && s.section && Array.isArray(s.section.fields),
    );
  } catch {
    return [];
  }
}

export function useDeckStore() {
  const [applied, setApplied] = useState<AppliedSection[]>([]);
  const [pending, setPending] = useState<PendingSection | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Monotonic source of unique render keys. Advanced past any restored keys
  // once localStorage is read so new sections never collide with old ones.
  const keyCounter = useRef(0);

  // Hydrate once on mount.
  useEffect(() => {
    const stored = readStored();
    if (stored.length > 0) {
      const maxKey = stored.reduce((m, s) => (s.key > m ? s.key : m), 0);
      keyCounter.current = maxKey + 1;
      setApplied(stored);
    }
    setHydrated(true);
  }, []);

  // Persist on every change to applied — but only after hydration, so the empty
  // initial state can't clobber stored sections before they're read back in.
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(applied));
    } catch {
      // Storage full / unavailable — non-fatal, the UI still works this session.
    }
  }, [applied, hydrated]);

  const nextKey = useCallback(() => {
    const k = keyCounter.current;
    keyCounter.current = k + 1;
    return k;
  }, []);

  const applyDirect = useCallback(
    (section: DeckSection) => {
      const entry: AppliedSection = { key: nextKey(), section };
      setApplied((prev) => [...prev, entry]);
    },
    [nextKey],
  );

  const propose = useCallback(
    (section: DeckSection) => {
      const entry: PendingSection = { key: nextKey(), section };
      setPending(entry);
    },
    [nextKey],
  );

  const accept = useCallback(() => {
    // Read pending from state (closure), then fire two INDEPENDENT pure
    // updaters. No nesting, no ref mutation inside an updater.
    if (!pending) return;
    setApplied((prev) => [...prev, pending]);
    setPending(null);
  }, [pending]);

  const reject = useCallback(() => {
    setPending(null);
  }, []);

  const editField = useCallback(
    (sectionKey: number, fieldIndex: number, value: string) => {
      setApplied((prev) =>
        prev.map((s) => {
          if (s.key !== sectionKey) return s;
          const fields = s.section.fields.map((f, i) =>
            i === fieldIndex ? { ...f, value } : f,
          );
          return { ...s, section: { ...s.section, fields } };
        }),
      );
    },
    [],
  );

  const reset = useCallback(() => {
    setApplied([]);
    setPending(null);
    keyCounter.current = 0;
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return {
    applied,
    pending,
    applyDirect,
    propose,
    accept,
    reject,
    editField,
    reset,
    hydrated,
  };
}

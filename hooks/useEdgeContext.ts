"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { EdgeTab } from "@/lib/edge-context";

const STORAGE_KEY = "fundexecs:edge_tab_history";
const MAX_HISTORY = 10;
const DEBOUNCE_MS = 8_000;
const FOCUS_DEBOUNCE_MS = 30_000;

function readHistory(): { url: string; title: string }[] {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function pushHistory(url: string, title: string) {
  const prev = readHistory().filter((h) => h.url !== url);
  const next = [{ url, title }, ...prev].slice(0, MAX_HISTORY);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage quota — silently skip
  }
}

function buildTabs(currentUrl: string, currentTitle: string): EdgeTab[] {
  const history = readHistory();
  const current: EdgeTab = {
    pageUrl: currentUrl,
    pageTitle: currentTitle,
    tabId: 1,
    isCurrent: true,
  };
  const rest: EdgeTab[] = history
    .filter((h) => h.url !== currentUrl)
    .slice(0, MAX_HISTORY - 1)
    .map((h, i) => ({ pageUrl: h.url, pageTitle: h.title, tabId: i + 2, isCurrent: false }));
  return [current, ...rest];
}

async function postEdgeContext(sessionId: string, tabs: EdgeTab[]) {
  try {
    await fetch("/api/edge-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tabs, session_id: sessionId }),
    });
  } catch {
    // non-fatal — edge context is supplementary
  }
}

// Sends browser navigation context to /api/edge-context so agents and chat
// replies can read workflow signals from the active session's tab history.
// Fires on: session activation, route navigation (debounced), window focus
// (long debounce to avoid storms on tab switches).
export function useEdgeContext(sessionId: string | null | undefined) {
  const pathname = usePathname();
  const lastSentRef = useRef<number>(0);
  const focusLastSentRef = useRef<number>(0);
  const sessionRef = useRef<string | null | undefined>(null);

  // Track navigation history in sessionStorage.
  useEffect(() => {
    const url = window.location.href;
    const title = document.title;
    pushHistory(url, title);
  }, [pathname]);

  // Send on session activation and route changes (debounced).
  // Effect 1 already pushed history for this pathname — just read it here.
  useEffect(() => {
    if (!sessionId) return;
    const now = Date.now();
    const isNewSession = sessionId !== sessionRef.current;
    if (!isNewSession && now - lastSentRef.current < DEBOUNCE_MS) return;

    sessionRef.current = sessionId;
    lastSentRef.current = now;

    void postEdgeContext(sessionId, buildTabs(window.location.href, document.title));
  }, [sessionId, pathname]);

  // Send on window focus (long debounce — user switched back to this tab).
  useEffect(() => {
    if (!sessionId) return;
    function onFocus() {
      const now = Date.now();
      if (!sessionId || now - focusLastSentRef.current < FOCUS_DEBOUNCE_MS) return;
      focusLastSentRef.current = now;
      const url = window.location.href;
      const title = document.title;
      void postEdgeContext(sessionId, buildTabs(url, title));
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [sessionId]);
}

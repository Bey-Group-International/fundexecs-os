"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "fx-recent-paths";
const MAX_RECENTS = 5;

// Friendly labels for known paths — falls back to the path segment.
const KNOWN_LABELS: Record<string, string> = {
  "/dashboard": "Command Center",
  "/dashboard/capital": "Capital Desk",
  "/dashboard/deals": "Deal Desk",
  "/dashboard/fund-room": "Fund Room",
  "/dashboard/investor-relations": "Investor Relations",
  "/dashboard/automation": "Automation Lab",
  "/dashboard/marketing": "Marketing Engine",
  "/dashboard/office": "Office",
  "/workspace": "Earn Workspace",
  "/automations": "Automated Sessions",
  "/inbox": "Inbox",
  "/source/pipeline": "Deal Pipeline",
  "/source/allocators": "Allocators",
  "/source/outreach": "Outreach",
  "/run/deal": "Deal War Room",
  "/run/underwriting": "Underwriting",
  "/run/diligence": "Diligence",
  "/execute/cap-table": "Cap Table",
  "/execute/portfolio": "Portfolio",
  "/execute/closing": "Closing",
  "/build/profile": "Profile",
  "/build/track-record": "Track Record",
  "/build/materials": "Materials",
};

function labelFor(path: string) {
  return KNOWN_LABELS[path] ?? path.split("/").filter(Boolean).pop() ?? path;
}

interface RecentEntry {
  path: string;
  label: string;
  ts: number;
}

export function RecentsStrip() {
  const pathname = usePathname();
  const [recents, setRecents] = useState<RecentEntry[]>([]);

  // On every navigation, persist the new path and refresh the strip.
  useEffect(() => {
    if (!pathname) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const current: RecentEntry[] = raw ? JSON.parse(raw) : [];
      // Deduplicate then prepend the current path.
      const without = current.filter((e) => e.path !== pathname);
      const updated: RecentEntry[] = [
        { path: pathname, label: labelFor(pathname), ts: Date.now() },
        ...without,
      ].slice(0, MAX_RECENTS + 1); // +1 because current path is filtered out below
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      // Exclude the current page from the strip — it's already highlighted in the nav.
      setRecents(updated.filter((e) => e.path !== pathname).slice(0, MAX_RECENTS));
    } catch {
      // localStorage unavailable — silently skip.
    }
  }, [pathname]);

  if (recents.length === 0) return null;

  return (
    <div
      aria-label="Recent destinations"
      className="flex items-center gap-1.5 overflow-x-auto"
    >
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
        Recent:
      </span>
      {recents.map((entry) => (
        <Link
          key={entry.path}
          href={entry.path}
          className="shrink-0 rounded border border-line/70 bg-surface-0/80 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          {entry.label}
        </Link>
      ))}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface HubContextBarProps {
  /** Key stat chips shown on the right. */
  stats?: Array<{ label: string; value: string | number; tone?: "good" | "warn" | "muted" }>;
  /** Optional quick-action button (e.g. "New Deal"). */
  quickAction?: { label: string; onClick: () => void };
}

const HUB_LABELS: Record<string, string> = {
  build: "Build",
  source: "Source",
  run: "Run",
  execute: "Execute",
  dashboard: "Dashboard",
};

const MODULE_LABELS: Record<string, string> = {
  profile: "Profile",
  "track-record": "Track Record",
  materials: "Materials",
  pipeline: "Deal Pipeline",
  allocators: "Allocator Directory",
  outreach: "Outreach Studio",
  "capital-map": "Capital Map",
  deal: "Deal War Room",
  underwriting: "Underwriting",
  diligence: "Diligence",
  "cap-table": "Cap Table",
  portfolio: "Portfolio",
  closing: "Closing",
};

const TONE_CLASS: Record<string, string> = {
  good: "text-status-success",
  warn: "text-status-warning",
  muted: "text-fg-muted",
};

/**
 * UX-11 — Hub context bar.
 *
 * A slim bar showing the current hub › module breadcrumb, optional stat chips,
 * and an optional quick-action button.  Mount it near the top of any hub module
 * page to orient the user and surface key numbers without scrolling.
 *
 * The breadcrumb is derived from the URL (no props needed) so it works without
 * any server data.  Stats and the quick-action are optional enhancements.
 */
export function HubContextBar({ stats, quickAction }: HubContextBarProps) {
  const pathname = usePathname() ?? "";
  const segments = pathname.split("/").filter(Boolean);
  // Expect paths like /build/profile or /source/pipeline
  const hubKey = segments[0] ?? "";
  const moduleKey = segments[1] ?? "";
  const hubLabel = HUB_LABELS[hubKey] ?? hubKey;
  const moduleLabel = MODULE_LABELS[moduleKey] ?? moduleKey;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line/60 bg-surface-1/60 px-3.5 py-2">
      {/* Breadcrumb */}
      <nav aria-label="Hub breadcrumb" className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider">
        <Link
          href={`/${hubKey}`}
          className="text-fg-muted transition hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          {hubLabel}
        </Link>
        {moduleLabel ? (
          <>
            <span className="text-fg-muted/50">›</span>
            <span className="text-fg-secondary">{moduleLabel}</span>
          </>
        ) : null}
      </nav>

      {/* Right side: stat chips + quick action */}
      <div className="flex items-center gap-3">
        {stats && stats.length > 0 ? (
          <div className="flex items-center gap-3">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {s.label}
                </span>
                <span
                  className={`font-mono text-xs font-medium ${
                    TONE_CLASS[s.tone ?? "muted"]
                  }`}
                >
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {quickAction ? (
          <button
            type="button"
            onClick={quickAction.onClick}
            className="rounded-lg border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-gold-400 transition hover:bg-gold-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            + {quickAction.label}
          </button>
        ) : null}

        {/* Ask Earn shortcut */}
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("earn:open-with-context", {
                detail: { prompt: `Help me with ${hubLabel} › ${moduleLabel}` },
              }),
            )
          }
          className="rounded-lg border border-line px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/40 hover:text-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          title="Ask Earn about this module"
        >
          ✦ Ask Earn
        </button>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { CapitalMapEntry, Temperature } from "@/lib/capital-map";
import type { GateTier } from "@/lib/gates";
import type { Approval } from "@/lib/supabase/database.types";

// The Capital Map's two most valuable reads, surfaced on the Command Center:
// the hottest investors (warmth-ranked) and the gates still waiting on the
// operator. Server-rendered — no interactivity here; the live surfaces
// (/capital-map, /workspace) own the action loops.

// Mirror CapitalMap.tsx's TEMP_STYLE so the chips read identically across both
// surfaces.
const TEMP_STYLE: Record<Temperature, { dot: string; label: string }> = {
  cold: { dot: "#6b7280", label: "Cold" },
  warm: { dot: "#e8a33d", label: "Warm" },
  active: { dot: "#5b9bd5", label: "Active" },
  committed: { dot: "#67c587", label: "Committed" },
};

// Mirror CapitalMap.tsx's TIER_STYLE: green = free, gold = sign-off, red = never
// delegable.
const TIER_STYLE: Record<GateTier, string> = {
  1: "border-status-success/40 text-status-success",
  2: "border-gold-500/50 text-gold-400",
  3: "border-status-danger/50 text-status-danger",
};

// Pull the leading "Tier N" out of an approval summary (the Capital Map writes
// them as `Tier N — …`). Falls back to Tier 2 — the operator-sign-off default.
function parseTier(summary: string): GateTier {
  const m = /^Tier\s+([123])/.exec(summary);
  return m ? (Number(m[1]) as GateTier) : 2;
}

export function HottestCapital({ entries }: { entries: CapitalMapEntry[] }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">
          Hottest capital
        </h2>
        <Link href="/capital-map" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
          Capital Map →
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No investors scored yet — add LPs in Source › LP Pipeline, then the{" "}
          <Link href="/capital-map" className="text-gold-400 hover:underline">
            Capital Map
          </Link>{" "}
          ranks them here by warmth.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map((entry) => {
            const temp = TEMP_STYLE[entry.temperature];
            return (
              <Link
                key={entry.investor.id}
                href="/capital-map"
                className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-1 px-3 py-2 transition hover:border-gold-500/60"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: temp.dot }}
                  title={temp.label}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg-primary">{entry.investor.name}</span>
                  <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {temp.label}
                    {entry.introPath && entry.introPath.introducer !== "You"
                      ? ` · intro via ${entry.introPath.introducer}`
                      : ""}
                  </span>
                </span>
                {entry.thesisFit ? (
                  <span className="ml-auto shrink-0 text-right">
                    <span className="font-display text-base font-semibold text-fg-primary">
                      {entry.thesisFit.score}
                      <span className="text-[11px] text-fg-muted">/100</span>
                    </span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PendingGates({ approvals }: { approvals: Approval[] }) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-mono text-xs uppercase tracking-wider text-fg-muted">
          Pending gates
        </h2>
        {approvals.length > 0 ? (
          <Link href="/workspace" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
            Review →
          </Link>
        ) : null}
      </div>
      {approvals.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Nothing waiting on you. Tier 2/3 actions Earn proposes land here for your
          sign-off before they reach a counterparty.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {approvals.map((a) => {
            const tier = parseTier(a.summary);
            // The summary is already "Tier N — …"; drop the prefix for the line
            // since the badge carries the tier.
            const text = a.summary.replace(/^Tier\s+[123]\s+—\s+/, "");
            return (
              <Link
                key={a.id}
                href="/workspace"
                className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-1 px-3 py-2 transition hover:border-gold-500/60"
              >
                <span
                  className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[tier]}`}
                >
                  T{tier}
                </span>
                <span className="min-w-0 truncate text-sm text-fg-primary">{text}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

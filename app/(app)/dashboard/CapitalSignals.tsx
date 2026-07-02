import Link from "next/link";
import type { CapitalMapEntry } from "@/lib/capital-map";
import { TEMP_STYLE } from "@/lib/capital-map";
import type { GateTier } from "@/lib/gates";
import { TIER_STYLE } from "@/lib/gates";
import type { Approval } from "@/lib/supabase/database.types";

// The Capital Map's two most valuable reads, surfaced on the Command Center:
// the hottest investors (warmth-ranked) and the gates still waiting on the
// operator. Server-rendered — no interactivity here; the live surfaces
// (/capital-map, /workspace) own the action loops.

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
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fg-muted">
          <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
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
                className="fx-card fx-card-hover flex items-center gap-2.5 px-3 py-2.5"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: temp.dot, boxShadow: `0 0 6px ${temp.dot}` }}
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
        <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fg-muted">
          <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
          Pending gates
        </h2>
        {approvals.length > 0 ? (
          <Link href="/grid/review" className="font-mono text-[10px] uppercase tracking-wider text-gold-400 hover:underline">
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
                href={`/grid/review?approval=${a.id}`}
                className="fx-card fx-card-hover flex items-center gap-2.5 px-3 py-2.5"
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

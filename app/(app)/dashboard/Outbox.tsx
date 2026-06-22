import Link from "next/link";
import type { DispatchLog } from "@/lib/supabase/database.types";

// The Outbox — the Command Center's read on the dispatch audit log. Every
// Tier-1 action Earn runs through the integration layer is recorded in
// `dispatch_log`; this surfaces the most recent ones so the operator can see
// what actually went out (and whether it was a real send or a mock). Server-
// rendered, no interactivity — a mirror of the dispatch ledger, nothing more.

// Compact relative time, e.g. "3m ago" / "2h ago" / "Apr 3". Mirrors the
// terse, mono-cased timestamps the rest of the dashboard favors.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Outbox({ rows }: { rows: DispatchLog[] }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-fg-muted">
        <span aria-hidden className="h-3 w-0.5 rounded-full bg-gold-500/70" />
        Outbox
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Nothing dispatched yet. Tier-1 actions Earn runs from the{" "}
          <Link href="/capital-map" className="text-gold-400 hover:underline">
            Capital Map
          </Link>{" "}
          land here as they go out.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="fx-card flex items-center gap-2.5 px-3 py-2.5"
            >
              {/* Live = a real external call; mock/queued = green prep only. */}
              <span
                className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                  row.live
                    ? "border-gold-500/50 text-gold-400"
                    : "border-line text-fg-muted"
                }`}
                title={row.live ? "Sent live" : "Mock — prepared, not sent"}
              >
                {row.live ? "Live" : "Mock"}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-fg-primary">
                  {row.action.replace(/_/g, " ")}
                  <span className="text-fg-muted"> · {row.channel}</span>
                </span>
                {row.detail ? (
                  <span className="block truncate text-[11px] text-fg-muted">{row.detail}</span>
                ) : null}
              </span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">
                {row.created_at ? relativeTime(row.created_at) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
